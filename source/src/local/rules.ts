// Règles de Tock Tock, EXPLIQUÉES : chaque règle dit ce qui se passe et pourquoi, et se rattache à l'un des 5 principes.
// Toute modification de fond doit changer RULES_VERSION : la personne devra alors accepter à nouveau (versionnage).
import { authServer } from './gotrue';

export const RULES_VERSION = '2026-10-16.5';

export const RULES_CHANGES = [
  'Nouvelle section 13 : discussion et partage de bilan avec un nom# (sans compte), réservée aux 15 ans et plus, avec ton accord à chaque demande de bilan.',
  'Une vraie page d\'accueil, des exercices guidés (scan corporel, relaxation, étirements, écriture…) et un onglet Discussion ont été ajoutés.',
  'Les règles sont maintenant rattachées à 5 principes simples, expliqués en tête de page.',
  'Nouvelles sections : objectifs et petites victoires, exercices et assistant, compte et code de connexion (e-mail ou téléphone), tes droits (exporter, supprimer), assistant avec IA (version serveur).',
  'Un écran de connexion ou d\'inscription par code reçu par e-mail ou SMS a été ajouté. Le code n\'est jamais affiché ni simulé par l\'application : il est envoyé et vérifié par un serveur.',
  'Un rapport de période en PDF est disponible (Historique > Rapport PDF) : douleur et notes n\'y figurent que si tu les coches.',
];

export type PrincipleId = 'donnees' | 'invention' | 'main' | 'humain' | 'honnete';
export interface Principle { id: PrincipleId; title: string; text: string }

/** Les 5 idées dont découlent toutes les règles : si une règle te semble étrange, cherche le principe qu'elle protège. */
export const PRINCIPLES: Principle[] = [
  { id: 'donnees', title: 'Tes données sont à toi', text: 'Tu les saisis, tu les exportes, tu les supprimes. Elles ne servent ni à la publicité ni à te classer : il n\'y a dans Tock Tock ni publicité ni suivi d\'audience.' },
  { id: 'invention', title: 'Rien n\'est inventé', text: 'Chaque chiffre, moyenne ou chronique vient de ce que tu as réellement saisi. Sans donnée, on affiche un vide plutôt qu\'un faux chiffre, et aucun code de vérification n\'est simulé.' },
  { id: 'main', title: 'Tu gardes la main', text: 'Tout est facultatif, modifiable et réversible autant que possible : tu peux sauter une question, passer en bilan rapide, exporter ou tout effacer.' },
  { id: 'humain', title: 'L\'humain d\'abord', text: 'Tock Tock n\'est ni un soignant ni une urgence. Face à une détresse, des ressources humaines passent avant tout le reste, et les décisions importantes (modération) sont prises et expliquées par des personnes.' },
  { id: 'honnete', title: 'Honnête sur ses limites', text: 'On te dit ce qui est testé ou non, ce qui n\'est pas protégé (un code PIN ne chiffre rien) et ce qu\'on ne promet pas (aucun délai de réponse garanti).' },
];

export interface Rule { rule: string; why: string; p: PrincipleId }
export interface RuleSection { id: string; title: string; scope?: string; intro: string; rules: Rule[] }

const online = !!authServer;

export const RULE_SECTIONS: RuleSection[] = [
  {
    id: 'nature', title: '1. Ce qu\'est (et n\'est pas) Tock Tock',
    intro: 'Un carnet de bord personnel, pour te connaître mieux. Rien de plus, rien de moins.',
    rules: [
      { p: 'humain', rule: 'Tock Tock n\'est pas un dispositif médical et ne pose aucun diagnostic.', why: 'Quelques chiffres saisis chaque jour ne suffisent pas à évaluer une santé. Une appli qui prétendrait le contraire te mettrait en danger.' },
      { p: 'humain', rule: 'Tock Tock ne remplace ni un soignant, ni un service d\'urgence.', why: 'En cas de détresse ou de danger, un humain formé peut agir ; pas une page web. La page « Aide » liste les services d\'écoute de ton pays.' },
      { p: 'main', rule: 'Tu restes libre de ne rien répondre : chaque question peut être passée.', why: 'Un suivi qui force à répondre finit par être abandonné, ou rempli de réponses inexactes.' },
    ],
  },
  {
    id: 'calcul', title: '2. Règles de calcul des moyennes',
    intro: 'Les moyennes sont exactes, jamais arrondies avant l\'affichage, et ne comptent que ce que tu as réellement répondu.',
    rules: [
      { p: 'invention', rule: 'Une question laissée vide n\'est jamais comptée comme zéro.', why: 'Ne pas répondre ne veut pas dire « tout va mal ». Compter 0 ferait baisser artificiellement tes moyennes les jours où tu as simplement manqué de temps.' },
      { p: 'invention', rule: 'Chaque réponse est ramenée sur 10 : (valeur − minimum) ÷ (maximum − minimum) × 10.', why: 'Une échelle 1-5 et une échelle 0-10 deviennent comparables. Ex. : 4 sur une échelle 1-5 vaut 7,5/10.' },
      { p: 'invention', rule: 'La moyenne d\'une catégorie est la moyenne de ses réponses numériques ; la moyenne générale est la moyenne des catégories qui ont des données.', why: 'Une catégorie de 8 questions ne doit pas peser plus qu\'une catégorie de 2. Exemple : Moral 8 et Joie 6 (émotionnel = 7) + Sommeil 4 (santé = 4) donne (7 + 4) ÷ 2 = 5,5 — et non 6.' },
      { p: 'invention', rule: 'La douleur, les textes, les oui/non et les indicateurs retirés de la moyenne ne sont jamais comptés.', why: 'Une douleur n\'est pas « une mauvaise note de moral » : la mélanger fausserait les deux. Elle a son propre suivi, séparé.' },
      { p: 'invention', rule: 'Sans aucune réponse numérique, la moyenne affiche « Moyenne indisponible ».', why: 'Mieux vaut un blanc honnête qu\'un chiffre inventé.' },
      { p: 'invention', rule: 'Si tu modifies, désactives ou supprimes un indicateur, les anciens bilans gardent la définition d\'origine.', why: 'Sinon, changer une échelle aujourd\'hui réécrirait ton passé et rendrait les courbes trompeuses.' },
      { p: 'invention', rule: 'Sur les graphiques, un jour sans bilan est un vide, jamais un zéro.', why: 'Relier des jours inconnus par une ligne ou les mettre à 0 raconterait une histoire fausse.' },
    ],
  },
  {
    id: 'chroniques', title: '3. Règles des chroniques de minuit',
    intro: 'Une chronique est un résumé de ta journée écrit à partir de ce que tu as saisi.',
    rules: [
      { p: 'invention', rule: 'La chronique n\'invente rien : elle ne reprend que tes réponses, tes notes et tes objectifs.', why: 'Un récit crédible mais inexact pourrait te faire douter de ton propre ressenti.' },
      { p: 'invention', rule: 'Sans données suffisantes, aucune chronique n\'est fabriquée.', why: 'Une « fausse » chronique remplie de généralités n\'aurait aucune valeur.' },
      { p: 'honnete', rule: 'Les jours passés sont rattrapés à l\'ouverture (14 jours maximum). Le jour en cours se génère à la demande.', why: 'Une chronique « de minuit » raconte une journée terminée. Au-delà de 14 jours, on évite de recréer en masse de vieux résumés que tu n\'as pas demandés.' },
      { p: 'donnees', rule: 'La douleur et les notes personnelles sont exclues du PDF de chronique par défaut.', why: 'Un PDF circule facilement (e-mail, impression). Les éléments les plus sensibles ne doivent y figurer que si tu le décides.' },
      { p: 'main', rule: 'Tu peux régénérer ou supprimer une chronique à tout moment ; ton bilan n\'est jamais touché.', why: 'La chronique est dérivée de tes données, pas l\'inverse.' },
    ],
  },
  {
    id: 'observations', title: '4. Règles des observations et séries',
    intro: 'Tock Tock décrit tes données ; il ne les interprète pas à ta place.',
    rules: [
      { p: 'invention', rule: 'Aucune observation avant 7 jours de bilans. Une tendance exige au moins 5 jours avec données sur chacune des deux périodes comparées.', why: 'Avec trop peu de jours, le hasard fait des « tendances ». Mieux vaut attendre.' },
      { p: 'invention', rule: 'Une étiquette n\'est comparée que si elle compte au moins 3 jours avec et 3 jours sans, et si l\'écart atteint 0,5 point.', why: 'On évite de t\'annoncer qu\'un événement « change tout » sur la base d\'un seul jour.' },
      { p: 'honnete', rule: 'Le lien sommeil/moral exige au moins 10 jours de données et se présente toujours comme un lien constaté, jamais une cause.', why: 'Deux choses qui varient ensemble ne s\'expliquent pas forcément l\'une l\'autre.' },
      { p: 'humain', rule: 'La série de jours se calcule en jours consécutifs avec bilan ; une pause remet la série en cours à zéro mais n\'efface ni la meilleure série ni tes données.', why: 'La série motive sans punir : il n\'y a ni classement, ni perte.' },
    ],
  },
  {
    id: 'objectifs', title: '5. Objectifs, étapes et petites victoires',
    intro: 'Pour avancer à ton rythme, sans pression ni comparaison.',
    rules: [
      { p: 'invention', rule: 'L\'avancement d\'un objectif se calcule uniquement à partir des étapes que tu coches.', why: '2 étapes faites sur 4 = 50 %, point. Aucun pourcentage « encourageant » inventé, et un objectif sans étape n\'affiche pas de pourcentage.' },
      { p: 'humain', rule: 'Un objectif non atteint n\'est pas un échec : tu peux le mettre en pause, le terminer ou l\'archiver, sans pénalité.', why: 'Culpabiliser fait abandonner. Les plans changent, et c\'est normal.' },
      { p: 'main', rule: 'Une échéance est un repère, pas une sanction : la dépasser ne supprime et ne bloque rien.', why: 'Tu décides si la date compte encore ; l\'application ne décide pas à ta place.' },
      { p: 'main', rule: 'Supprimer un objectif supprime ses étapes, mais jamais tes bilans.', why: 'Chaque donnée a son propre espace : retirer un projet ne doit pas effacer ton historique.' },
      { p: 'humain', rule: 'Tes petites victoires sont notées par toi et ne sont jamais comparées à celles des autres.', why: 'Noter ce qui va bien aide, à condition de ne pas devenir une course.' },
    ],
  },
  {
    id: 'bienetre', title: '6. Respiration, ancrage, assistant et bibliothèque',
    intro: 'Des outils pour se poser et s\'informer, à utiliser avec bon sens.',
    rules: [
      { p: 'humain', rule: 'Les exercices de respiration et d\'ancrage sont des outils de détente, pas un traitement.', why: 'Ils peuvent aider à se poser ; ils ne soignent pas une anxiété ou une dépression. Si cela ne suffit pas, parle à un professionnel.' },
      { p: 'main', rule: 'Tu peux arrêter un exercice à tout moment. Si tu te sens mal à l\'aise ou pris de vertige, reprends une respiration normale.', why: 'Ton ressenti passe avant la consigne.' },
      { p: 'honnete', rule: 'L\'assistant de cette version est un guide aux réponses écrites à l\'avance : il n\'utilise aucune intelligence artificielle et ne diagnostique rien.', why: 'Tu sais toujours qui te répond : un script relu et fixe, pas un modèle qui improvise.' },
      { p: 'humain', rule: 'Si tes mots évoquent une détresse, l\'assistant s\'interrompt et te montre d\'abord des ressources humaines.', why: 'Une personne qui va mal a besoin d\'un humain avant d\'avoir besoin d\'un exercice.' },
      { p: 'honnete', rule: 'Les articles de la bibliothèque informent ; ils ne remplacent pas l\'avis d\'un professionnel.', why: 'Un texte général ne connaît pas ta situation.' },
    ],
  },
  {
    id: 'confidentialite', title: '7. Confidentialité, sauvegardes et code PIN',
    intro: online ? 'Tes bilans sont dans ton navigateur. Seule la connexion par code contacte un serveur.' : 'Cette version fonctionne sans serveur : tes données sont dans ton navigateur.',
    rules: [
      online
        ? { p: 'donnees', rule: 'Tes bilans, notes, douleur et objectifs ne quittent jamais ton appareil. Seule la connexion par code contacte le serveur d\'authentification.', why: 'La page n\'est autorisée (politique de sécurité du navigateur) à parler qu\'à ce serveur-là, et uniquement pour t\'envoyer puis vérifier un code.' }
        : { p: 'donnees', rule: 'Rien n\'est envoyé sur Internet : la page est bloquée en réseau par sa propre politique de sécurité.', why: 'Tes bilans n\'ont pas à quitter ton appareil. Tu peux le vérifier : la page fonctionne sans connexion.' },
      { p: 'honnete', rule: 'Vider les données du navigateur efface tout. Fais des sauvegardes PDF régulières ; un rappel apparaît après 14 jours.', why: 'Il n\'existe pas de copie ailleurs. C\'est le prix de la confidentialité totale.' },
      { p: 'donnees', rule: 'Le PDF de sauvegarde contient TOUTES tes données (bilans, notes, douleur, objectifs). Garde-le comme un document privé.', why: 'Une sauvegarde incomplète ne servirait à rien le jour où tu en as besoin ; mais elle est aussi sensible que l\'original.' },
      { p: 'donnees', rule: 'Le rapport PDF de période n\'inclut ni la douleur ni tes notes, sauf si tu les coches une par une.', why: 'Ce document est fait pour être montré (à un soignant, par exemple) : tu décides à chaque fois de ce que tu partages.' },
      { p: 'honnete', rule: 'Le code PIN masque l\'écran à l\'ouverture, il ne chiffre pas les données.', why: 'Il protège contre un regard de passage, pas contre quelqu\'un qui sait ouvrir les outils du navigateur. Mieux vaut ne pas laisser d\'autres personnes utiliser ta session.' },
      { p: 'donnees', rule: 'Les tickets d\'aide sont enregistrés sur ton appareil et ne contiennent que ce que tu écris, plus (si tu coches la case) des informations techniques sans aucun contenu de bilan.', why: 'Demander de l\'aide ne doit jamais t\'obliger à exposer tes données personnelles.' },
    ],
  },
  {
    id: 'compte', title: '8. Compte, e-mail, téléphone et code de connexion',
    intro: 'Pas de mot de passe à retenir : tu prouves que l\'adresse ou le numéro est à toi grâce à un code envoyé.',
    rules: [
      { p: 'main', rule: 'Dans la version fichier, un compte n\'est jamais obligatoire : tu peux « continuer sans compte ».', why: 'Ton suivi ne doit pas dépendre d\'un service en ligne. Le compte n\'ajoute ici qu\'une preuve que l\'identifiant est bien à toi.' },
      { p: 'honnete', rule: 'Le format de l\'adresse ou du numéro est vérifié avant tout envoi, et l\'écran te dit précisément ce qui ne va pas.', why: 'Une faute de frappe enverrait un code à un inconnu ; et chaque SMS a un coût. Attention : un format valide ne prouve pas que l\'adresse ou le numéro existe, seul le code le prouve.' },
      { p: 'honnete', rule: 'Un numéro doit être un mobile : 06 ou 07 en France, ou une forme internationale commençant par « + » et l\'indicatif du pays.', why: 'Une ligne fixe ou une box ne reçoit pas de SMS. Sans « + », le numéro est lu comme un numéro français.' },
      { p: 'invention', rule: 'Le code est envoyé et vérifié par le serveur d\'authentification. L\'application ne le génère jamais, ne l\'affiche jamais et ne le simule jamais.', why: 'Si l\'application connaissait le code, n\'importe qui pourrait entrer à ta place. Un faux code donnerait une fausse impression de sécurité.' },
      { p: 'honnete', rule: 'Le code comporte 6 chiffres, expire au bout de 10 minutes et ne s\'utilise qu\'une fois ; utilise toujours le dernier code reçu.', why: 'Limiter la durée limite le risque si quelqu\'un voit ton écran ou ton téléphone.' },
      { p: 'humain', rule: 'Au plus un envoi par minute, et un nombre d\'essais limité (5 par code dans l\'écran, plus une limite côté serveur).', why: 'Un code à 6 chiffres a un million de possibilités : sans limite, on pourrait le deviner au hasard, ou te faire payer des SMS à répétition.' },
      { p: 'humain', rule: 'Personne de Tock Tock ne te demandera jamais ton code, ni par e-mail, ni par SMS, ni par téléphone.', why: 'C\'est l\'arnaque la plus courante : quelqu\'un te demande « le code que tu viens de recevoir » pour entrer dans ton compte.' },
      { p: 'donnees', rule: 'Ton e-mail et ton numéro ne sont jamais visibles des autres membres et ne servent qu\'à te connecter (et à t\'envoyer ta chronique par e-mail si tu l\'actives).', why: 'Un identifiant de connexion n\'a pas à devenir une coordonnée publique.' },
      { p: 'donnees', rule: 'Un SMS ne contient que le code : jamais une donnée de bien-être.', why: 'Un SMS s\'affiche sur l\'écran verrouillé et peut être lu par n\'importe qui autour de toi.' },
      { p: 'donnees', rule: 'L\'écran de connexion ne dit jamais si une adresse ou un numéro possède déjà un compte.', why: 'Sinon n\'importe qui pourrait vérifier si une personne précise utilise Tock Tock.' },
      { p: 'donnees', rule: 'Dans la version fichier, un compte confirmé ne conserve que la forme masquée de ton identifiant (par exemple p•••••@exemple.fr), jamais l\'adresse complète ni de jeton de connexion.', why: 'Ce qu\'on ne garde pas ne peut ni fuiter ni être copié depuis ta sauvegarde.' },
    ],
  },
  {
    id: 'droits', title: '9. Tes droits : voir, exporter, corriger, supprimer',
    intro: 'Tes données restent les tiennes, à tout moment.',
    rules: [
      { p: 'main', rule: 'Tu peux exporter tout ce que tu as saisi : sauvegarde PDF (restaurable) et CSV de tes réponses.', why: 'Pouvoir partir avec ses données est la meilleure garantie de ne pas être enfermé.' },
      { p: 'main', rule: 'Tu peux modifier tes réponses et supprimer tes objectifs, chroniques et petites victoires.', why: 'Se tromper ou changer d\'avis est normal : l\'outil doit suivre.' },
      { p: 'main', rule: '« Tout supprimer » (Réglages) efface définitivement les données de cet appareil, après confirmation en tapant SUPPRIMER.', why: 'C\'est irréversible : la confirmation évite l\'erreur de clic. Fais d\'abord une sauvegarde si tu hésites.' },
      { p: 'donnees', rule: 'Les PDF déjà téléchargés restent chez toi et sous ta responsabilité tant que tu les gardes.', why: 'Tock Tock ne peut pas les effacer à ta place : range-les, ou supprime-les si tu n\'en as plus besoin.' },
      { p: 'main', rule: 'Avec la version serveur, tu peux supprimer ton compte et tes données depuis les Réglages.', why: 'Quitter le service doit être aussi simple que s\'y inscrire.' },
    ],
  },
  {
    id: 'aide', title: '10. Règles d\'aide, de tickets et d\'urgence',
    intro: 'Le centre d\'aide sert aux questions et aux problèmes d\'utilisation.',
    rules: [
      { p: 'humain', rule: 'Un ticket n\'est pas un service d\'urgence. Si tu écris quelque chose qui évoque une détresse, des ressources d\'aide humaines s\'affichent aussitôt.', why: 'Un ticket peut attendre plusieurs jours ; une personne en détresse, non.' },
      { p: 'honnete', rule: 'Dans cette version locale, un ticket n\'est pas envoyé automatiquement : tu l\'exportes (PDF, copie ou e-mail) et tu le transmets.', why: 'Aucun serveur ne reçoit les tickets : annoncer un « envoi » serait mentir. Avec la version serveur, le ticket arrive directement dans la file du support.' },
      { p: 'honnete', rule: 'Aucun délai de réponse n\'est promis tant qu\'aucune équipe de support n\'est désignée.', why: 'Promettre un délai que personne ne tient est pire que ne rien promettre.' },
      { p: 'donnees', rule: 'Évite de mettre dans un ticket des mots de passe, codes (y compris le code de connexion) ou données de santé détaillées.', why: 'Un ticket circule : mieux vaut décrire le problème que recopier tes données.' },
    ],
  },
  {
    id: 'communaute', title: '11. Règles de la communauté', scope: 'Version serveur uniquement',
    intro: 'Ces règles s\'appliquent à la version avec comptes (dossier « source »). Elles sont listées ici pour que tu saches à quoi t\'attendre.',
    rules: [
      { p: 'humain', rule: 'Bienveillance : pas d\'insultes, de harcèlement, de menaces ni de discrimination.', why: 'Un espace de soutien ne fonctionne que si chacun s\'y sent en sécurité.' },
      { p: 'donnees', rule: 'Pas de données privées (les tiennes ou celles d\'autres personnes), pas d\'arnaque ni de publicité.', why: 'Ce qui est publié peut être lu par beaucoup de gens, et ne se retire pas toujours.' },
      { p: 'humain', rule: 'Pas de conseil médical présenté comme certain, pas d\'incitation à des pratiques dangereuses.', why: 'Un témoignage est précieux ; une prescription déguisée peut faire du mal.' },
      { p: 'humain', rule: 'Les réactions sont uniquement positives et il n\'y a aucun classement.', why: 'La comparaison et la course aux « likes » nuisent au bien-être.' },
      { p: 'humain', rule: 'Chaque contenu peut être signalé ; des humains examinent, expliquent leurs décisions, et tu peux faire appel.', why: 'Un filtre automatique se trompe : la décision finale doit être humaine et contestable.' },
      { p: 'honnete', rule: 'Les sanctions sont graduées (avertissement, restriction, suspension) et tracées.', why: 'Pour rester proportionnées et vérifiables.' },
      { p: 'humain', rule: 'La communauté est fermée aux moins de 15 ans ; l\'âge est déclaratif.', why: 'Protection des plus jeunes. Limite connue : l\'âge n\'est pas vérifié.' },
    ],
  },
  {
    id: 'ia', title: '12. Assistant avec intelligence artificielle', scope: 'Version serveur uniquement',
    intro: 'Dans la version serveur, l\'assistant peut s\'appuyer sur une IA. Elle est facultative et encadrée.',
    rules: [
      { p: 'main', rule: 'L\'IA est désactivée tant que tu ne l\'as pas activée toi-même, et tu peux la désactiver à tout moment.', why: 'Envoyer ses mots à un fournisseur externe est un choix personnel, pas une obligation pour utiliser l\'appli.' },
      { p: 'donnees', rule: 'Tu choisis ce qu\'elle peut lire (bilans, objectifs, chroniques, douleur) : rien n\'est partagé par défaut, et la mémoire de l\'assistant est désactivée par défaut.', why: 'Moins l\'IA en sait, moins il y a de données exposées : tu n\'ouvres que ce dont tu as besoin.' },
      { p: 'humain', rule: 'Avant tout envoi à l\'IA, ton message est analysé : en cas de détresse, des ressources humaines passent avant toute réponse automatique.', why: 'Une IA peut répondre à côté ; une personne en détresse mérite mieux qu\'un texte généré.' },
      { p: 'humain', rule: 'Les moins de 15 ans n\'ont pas accès à l\'IA d\'un fournisseur externe.', why: 'Protection des plus jeunes, appliquée par la base de données et pas seulement par l\'écran.' },
      { p: 'honnete', rule: 'L\'IA peut se tromper : ses réponses ne sont ni un avis médical ni une vérité.', why: 'Un texte fluide peut être faux. Vérifie, et parle à un professionnel pour toute question de santé.' },
    ],
  },
  {
    id: 'discussion', title: '13. Discussion et partage de bilan (nom#)', scope: 'Version discussion (avec le petit serveur)',
    intro: 'Discuter avec des personnes que tu connais, sans compte : ton nom# (par exemple Léo#18428) sert d\'adresse.',
    rules: [
      { p: 'humain', rule: 'La discussion est réservée aux 15 ans et plus : tu l\'affirmes en l\'activant.', why: 'Protection des plus jeunes. Limite connue : l\'âge est déclaratif, il n\'est pas vérifié.' },
      { p: 'donnees', rule: 'Il n\'y a ni annuaire ni salon public : on ne peut écrire qu\'à quelqu\'un dont on connaît le nom#.', why: 'Ainsi personne ne peut être contacté en masse par des inconnus. Le nom ET le numéro doivent correspondre.' },
      { p: 'donnees', rule: 'Ton nom# est un pseudonyme : le numéro est tiré au hasard et ne contient ni ton e-mail ni ton téléphone. Sans compte, c\'est une clé secrète gardée sur ton appareil qui prouve que le numéro est le tien.', why: 'Personne ne peut écrire ou lire à ta place. Si tu vides les données du navigateur, la clé disparaît : tu auras alors un nouveau numéro.' },
      { p: 'donnees', rule: 'Personne ne voit ton bilan sans ton accord à chaque demande. Seules les moyennes du jour sont partagées ; la douleur et ta note ne partent que si tu les coches.', why: 'Ton bilan est ce que tu as de plus privé. Tu choisis, à chaque fois, ce que l\'autre peut voir. Un jour sans bilan s\'affiche « pas encore de bilan », jamais comme un zéro.' },
      { p: 'main', rule: '« Toujours autoriser » ne donne que les moyennes du jour et se retire d\'un clic.', why: 'Un accord pratique ne doit jamais devenir un accord oublié.' },
      { p: 'main', rule: 'Tu peux bloquer quelqu\'un à tout moment ; la personne bloquée n\'en est pas informée.', why: 'Se protéger ne doit pas déclencher de représailles.' },
      { p: 'honnete', rule: 'Les messages ne sont pas chiffrés de bout en bout : le relais les garde en mémoire (24 h au plus, effacés dès réception) et celui qui l\'héberge pourrait les lire. N\'écris ni mot de passe, ni code, ni information de santé détaillée.', why: 'Mieux vaut savoir ce qui n\'est pas protégé que croire à une confidentialité qui n\'existe pas.' },
      { p: 'humain', rule: 'La discussion n\'est pas un service d\'urgence : si tu écris des mots qui évoquent une détresse, des ressources d\'aide s\'affichent (ton message part quand même).', why: 'On n\'empêche personne de parler, mais on s\'assure qu\'il sache où trouver une aide humaine.' },
      { p: 'humain', rule: 'Bienveillance : pas d\'insultes, de harcèlement ni de menaces. Il n\'y a pas de modération humaine ici : c\'est pour cela que le blocage existe et qu\'on ne parle qu\'à des personnes qu\'on connaît.', why: 'Sans équipe pour intervenir, les protections doivent être dans tes mains.' },
      { p: 'honnete', rule: 'Un message n\'est livré que si la personne a activé la discussion et que le relais fonctionne. Il n\'y a pas d\'accusé de lecture, et si le relais est éteint, l\'écran le dit.', why: 'Annoncer « envoyé » quand rien n\'est arrivé serait mentir.' },
    ],
  },
];

/** Texte brut des règles (pour le PDF de sauvegarde et la copie). */
export function rulesAsText(): string {
  const principles = PRINCIPLES.map((p, i) => `${i + 1}. ${p.title} : ${p.text}`).join('\n');
  const label = (id: PrincipleId) => PRINCIPLES.find((p) => p.id === id)!.title;
  return `LES 5 PRINCIPES\n${principles}\n\n` + RULE_SECTIONS.map((s) => `${s.title}${s.scope ? ` (${s.scope})` : ''}\n${s.intro}\n${s.rules.map((r) => `- ${r.rule}\n  Pourquoi : ${r.why}\n  Principe : ${label(r.p)}`).join('\n')}`).join('\n\n');
}
