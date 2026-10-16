// Données statiques de la version « locale » de Tock Tock : modèles d'indicateurs, étiquettes, textes de la bibliothèque.
// (Mêmes 5 catégories / 20 indicateurs que les migrations SQL de la version serveur.)

export const CATEGORIES = [
  { key: 'emotional', label: 'État émotionnel', order: 1 },
  { key: 'health', label: 'Santé ressentie et énergie', order: 2 },
  { key: 'social', label: 'Vie sociale et personnelle', order: 3 },
  { key: 'work', label: 'Études, travail et projets', order: 4 },
  { key: 'daily', label: 'Vie quotidienne et épanouissement', order: 5 },
] as const;

export const INDICATORS = [
  { key: 'mood', cat: 'emotional', name: 'Moral général', desc: 'Comment as-tu vécu ta journée sur le plan du moral ?', order: 1 },
  { key: 'joy', cat: 'emotional', name: 'Joie et plaisir', desc: 'As-tu ressenti de la joie ou du plaisir aujourd\'hui ?', order: 2 },
  { key: 'serenity', cat: 'emotional', name: 'Sérénité', desc: 'T\'es-tu senti·e plutôt calme et apaisé·e ?', order: 3 },
  { key: 'confidence', cat: 'emotional', name: 'Confiance en soi', desc: 'Comment te sentais-tu dans tes capacités ?', order: 4 },
  { key: 'energy', cat: 'health', name: 'Énergie physique', desc: 'Quel niveau d\'énergie avais-tu ?', order: 5 },
  { key: 'sleep', cat: 'health', name: 'Qualité du sommeil', desc: 'Comment as-tu dormi la nuit dernière ?', order: 6 },
  { key: 'recovery', cat: 'health', name: 'Capacité à récupérer', desc: 'As-tu pu te reposer et récupérer quand il le fallait ?', order: 7 },
  { key: 'comfort', cat: 'health', name: 'Confort physique (hors douleur)', desc: 'Comment te sentais-tu physiquement, en dehors de toute douleur ?', order: 8 },
  { key: 'surrounded', cat: 'social', name: 'Sentiment d\'être entouré·e', desc: 'T\'es-tu senti·e entouré·e ?', order: 9 },
  { key: 'exchanges', cat: 'social', name: 'Qualité des échanges', desc: 'Comment se sont passés tes échanges avec les autres ?', order: 10 },
  { key: 'understood', cat: 'social', name: 'Sentiment d\'être compris·e', desc: 'T\'es-tu senti·e compris·e ?', order: 11 },
  { key: 'balance', cat: 'social', name: 'Équilibre entre les autres et le temps pour soi', desc: 'As-tu trouvé un bon équilibre entre les autres et toi ?', order: 12 },
  { key: 'study_work', cat: 'work', name: 'Avancement des études ou du travail', desc: 'As-tu avancé dans tes études ou ton travail ?', order: 13 },
  { key: 'projects', cat: 'work', name: 'Avancement des projets personnels', desc: 'As-tu avancé sur tes projets personnels ?', order: 14 },
  { key: 'productivity', cat: 'work', name: 'Productivité adaptée à mon énergie', desc: 'As-tu fait ce qui était réaliste avec l\'énergie que tu avais ?', order: 15 },
  { key: 'motivation', cat: 'work', name: 'Motivation pour les projets', desc: 'Comment était ta motivation ?', order: 16 },
  { key: 'progress', cat: 'daily', name: 'Sentiment d\'avoir avancé', desc: 'As-tu eu le sentiment d\'avancer ?', order: 17 },
  { key: 'pride', cat: 'daily', name: 'Fierté personnelle', desc: 'Y a-t-il quelque chose dont tu es fier·e ?', order: 18 },
  { key: 'pleasant', cat: 'daily', name: 'Moments agréables', desc: 'As-tu vécu des moments agréables ?', order: 19 },
  { key: 'satisfaction', cat: 'daily', name: 'Satisfaction générale', desc: 'Dans l\'ensemble, comment évalues-tu ta journée ?', order: 20 },
] as const;

/** Étiquettes rapides pour décrire la journée (servent aux observations « jours avec / sans »). */
export const TAGS = ['Sport', 'Nature / dehors', 'Travail / études', 'Famille', 'Amis', 'Seul·e', 'Sortie', 'Écrans tard', 'Stress', 'Fatigue', 'Bon repas', 'Créativité', 'Repos', 'Imprévu'];

export const BODY_ZONES = ['Tête', 'Nuque / cou', 'Dos', 'Épaules', 'Ventre', 'Bras / mains', 'Jambes / pieds', 'Articulations', 'Autre'];

export const BREATHING = [
  { id: 'coherence', name: 'Cohérence 5-5', phases: [['Inspire', 5], ['Expire', 5]] as [string, number][], minutes: 3, note: 'Respiration régulière et douce, très simple à suivre.' },
  { id: 'square', name: 'Carrée 4-4-4-4', phases: [['Inspire', 4], ['Retiens', 4], ['Expire', 4], ['Pause', 4]] as [string, number][], minutes: 2, note: 'Utile pour se recentrer. Si les pauses te gênent, utilise la cohérence 5-5.' },
  { id: '478', name: 'Apaisante 4-7-8', phases: [['Inspire', 4], ['Retiens', 7], ['Expire', 8]] as [string, number][], minutes: 2, note: 'Plus exigeante : arrête-toi à la moindre gêne (vertige, malaise). Commence par 2 ou 3 cycles.' },
];

export const GROUNDING = [
  { n: 5, sense: 'choses que tu vois', hint: 'Regarde autour de toi et nomme-les, doucement.' },
  { n: 4, sense: 'choses que tu peux toucher', hint: 'Le tissu de tes vêtements, la table, ta tasse…' },
  { n: 3, sense: 'sons que tu entends', hint: 'Même les plus discrets : le vent, un appareil, ta respiration.' },
  { n: 2, sense: 'odeurs que tu perçois', hint: 'Ou deux odeurs que tu aimes bien, si rien ne ressort.' },
  { n: 1, sense: 'chose que tu goûtes ou une qualité que tu apprécies chez toi', hint: 'Une gorgée d\'eau, ou une phrase gentille pour toi.' },
];

export interface Article { id: string; title: string; tag: string; body: string }

export const LIBRARY: Article[] = [
  {
    id: 'moyenne', title: 'Comprendre ta moyenne dans Tock Tock', tag: 'Utiliser l\'appli',
    body: 'Chaque réponse sur une échelle est ramenée sur 10. Une question laissée vide n\'existe pas : elle n\'est **jamais** comptée comme zéro.\n\nLa moyenne d\'une catégorie est la moyenne de ses réponses. La **moyenne générale** est la moyenne des catégories qui ont des données : une catégorie de 8 questions ne pèse pas plus qu\'une catégorie de 2 questions.\n\nLa douleur, les textes et les oui/non ne sont pas dans les moyennes. S\'il n\'y a aucune réponse numérique, tu verras « Moyenne indisponible », ce qui est normal.',
  },
  {
    id: 'sommeil', title: 'Mieux dormir : quelques bases', tag: 'Sommeil',
    body: 'Se coucher et se lever à des heures proches chaque jour aide l\'horloge interne.\n\nÉviter les écrans lumineux dans l\'heure qui précède le coucher, garder la chambre fraîche et sombre, limiter la caféine en fin de journée : ce sont des repères généraux, pas des règles strictes.\n\nTon indicateur « Qualité du sommeil » te permet d\'observer ce qui change sur plusieurs semaines. Si ton sommeil reste très perturbé, parles-en à un médecin : cette appli n\'est pas un outil médical.',
  },
  {
    id: 'stress', title: 'Respiration et stress : pourquoi ça aide', tag: 'Stress',
    body: 'Expirer lentement active la partie du système nerveux qui aide le corps à se détendre. Quelques minutes suffisent souvent à faire redescendre la tension.\n\nDans l\'onglet **Bien-être**, tu trouves trois rythmes guidés. Choisis le plus confortable ; arrête-toi en cas de vertige ou de gêne.\n\nCe n\'est pas un traitement : si l\'anxiété t\'envahit au quotidien, un professionnel peut vraiment t\'aider.',
  },
  {
    id: 'objectifs', title: 'Des objectifs petits et atteignables', tag: 'Objectifs',
    body: 'Un objectif découpé en étapes de quelques minutes se démarre plus facilement.\n\nFormule l\'étape suivante comme une action précise (« écrire 5 lignes », « marcher 10 minutes »), pas comme un résultat flou.\n\nCélébrer une petite étape compte : note-la dans **Victoires**. Un jour sans progrès n\'annule rien.',
  },
  {
    id: 'douleur', title: 'Suivre une douleur de façon utile', tag: 'Santé',
    body: 'Noter l\'intensité (0 à 10), la zone et le contexte (activité, sommeil, stress) peut aider à repérer des habitudes et à mieux expliquer la situation à un professionnel de santé.\n\nDans Tock Tock, la douleur est **séparée** des moyennes : une journée douloureuse ne « fausse » pas tes autres indicateurs.\n\nUne douleur intense, nouvelle ou inhabituelle justifie un avis médical : ne te fie pas à une appli pour décider.',
  },
  {
    id: 'aide', title: 'Quand et comment demander de l\'aide', tag: 'Aide',
    body: 'Demander de l\'aide n\'est pas un échec. Si tu te sens submergé·e, si tu as des idées noires ou si tu penses à te faire du mal, parle à une personne de confiance et contacte un service d\'écoute (liste dans l\'onglet **Aide**).\n\nEn cas de danger immédiat, appelle les urgences de ton pays (112 en Europe).\n\nTock Tock ne remplace ni un soignant, ni un service d\'urgence.',
  },
];

export interface ExStep { text: string; seconds?: number }
export interface Exercise { id: string; name: string; kind: 'corps' | 'esprit' | 'écriture' | 'mouvement'; minutes: number; intro: string; steps: ExStep[]; write?: { prompts: string[]; keep: boolean } }

/** Exercices guidés : de la détente et de l'attention, jamais un traitement. Les textes écrits ne sont gardés que si « keep » est vrai. */
export const EXERCISES: Exercise[] = [
  { id: 'scan', name: 'Scan corporel', kind: 'corps', minutes: 4, intro: 'Promène ton attention dans le corps, sans rien chercher à changer.', steps: [
    { text: 'Installe-toi, ferme les yeux si tu le souhaites. Sens le contact de ton corps avec le siège ou le sol.', seconds: 20 },
    { text: 'Pieds et chevilles : qu\'y sens-tu ? Chaleur, fourmillements, rien de particulier : tout est bien.', seconds: 25 },
    { text: 'Jambes et bassin : laisse le poids s\'abandonner.', seconds: 25 },
    { text: 'Ventre et dos : remarque le mouvement de la respiration.', seconds: 25 },
    { text: 'Mains, bras, épaules : relâche une tension si tu en trouves une.', seconds: 25 },
    { text: 'Nuque, mâchoire, visage : desserre les dents, détends le front.', seconds: 25 },
    { text: 'Prends une respiration plus ample et ressens ton corps dans son ensemble. Rouvre doucement les yeux.', seconds: 20 },
  ] },
  { id: 'prm', name: 'Relaxation musculaire', kind: 'corps', minutes: 5, intro: 'Serre chaque groupe de muscles 5 secondes (sans douleur), puis relâche complètement.', steps: [
    { text: 'Poings : serre doucement… puis relâche.', seconds: 12 }, { text: 'Avant-bras et bras : contracte… puis relâche.', seconds: 12 },
    { text: 'Épaules : monte-les vers les oreilles… puis relâche.', seconds: 12 }, { text: 'Visage : fronce, serre les paupières… puis relâche.', seconds: 12 },
    { text: 'Ventre : contracte légèrement… puis relâche.', seconds: 12 }, { text: 'Cuisses et fessiers : serre… puis relâche.', seconds: 12 },
    { text: 'Pieds : recroqueville les orteils… puis relâche. Respire tranquillement quelques instants.', seconds: 20 },
  ] },
  { id: 'etirements', name: 'Étirements express', kind: 'mouvement', minutes: 2, intro: 'Quelques mouvements doux, à arrêter à la moindre douleur.', steps: [
    { text: 'Nuque : incline la tête vers l\'épaule droite, puis la gauche, sans forcer.', seconds: 20 }, { text: 'Épaules : fais lentement 5 grands cercles vers l\'arrière.', seconds: 15 },
    { text: 'Poignets et doigts : ouvre, ferme, fais tourner les poignets.', seconds: 15 }, { text: 'Dos : assis, tourne doucement le buste d\'un côté puis de l\'autre.', seconds: 20 },
    { text: 'Debout : monte sur la pointe des pieds, étire-toi vers le haut, puis relâche.', seconds: 15 },
  ] },
  { id: 'marche', name: 'Marche attentive', kind: 'mouvement', minutes: 5, intro: 'Marche lentement et porte ton attention sur les sensations plutôt que sur tes pensées.', steps: [
    { text: 'Debout, sens le poids de ton corps sur tes pieds.', seconds: 15 }, { text: 'Marche lentement : sens le talon, puis la plante, puis les orteils.', seconds: 60 },
    { text: 'Remarque les sons autour de toi, sans les juger.', seconds: 45 }, { text: 'Remarque ce que tu vois : lumières, couleurs, formes.', seconds: 45 },
    { text: 'Quand ton esprit s\'égare, reviens simplement aux pas. Ce n\'est pas un échec.', seconds: 60 },
  ] },
  { id: 'lieusur', name: 'Lieu sûr (visualisation)', kind: 'esprit', minutes: 3, intro: 'Imagine un endroit, réel ou inventé, où tu te sens calme. Si une image te met mal à l\'aise, change de lieu ou arrête.', steps: [
    { text: 'Choisis un lieu où tu te sens bien : plage, forêt, pièce de ton enfance…', seconds: 20 }, { text: 'Qu\'y vois-tu ? Couleurs, lumière, formes.', seconds: 25 },
    { text: 'Qu\'y entends-tu ? Qu\'y sens-tu (température, odeurs) ?', seconds: 25 }, { text: 'Sens ton corps détendu dans ce lieu. Respire-y tranquillement.', seconds: 40 },
    { text: 'Garde cette sensation avec toi, puis reviens doucement à la pièce où tu es.', seconds: 20 },
  ] },
  { id: 'emotion', name: 'Nommer son émotion', kind: 'esprit', minutes: 3, intro: 'Mettre un mot précis sur ce qu\'on ressent aide souvent à prendre du recul.', steps: [
    { text: 'Pose-toi : qu\'est-ce que je ressens, là, maintenant ? Reste simple : tristesse, colère, peur, joie, fatigue…', seconds: 25 },
    { text: 'Où le sens-tu dans le corps ? Poitrine, ventre, gorge, épaules ?', seconds: 25 }, { text: 'Si tu devais lui donner une intensité de 0 à 10, ce serait combien ?', seconds: 15 },
    { text: 'Dis-toi : « C\'est une émotion, elle est là, elle va passer. » Respire lentement trois fois.', seconds: 30 },
  ] },
  { id: 'gratitude', name: 'Trois bonnes choses', kind: 'écriture', minutes: 3, intro: 'Note trois choses, même toutes petites, qui se sont bien passées aujourd\'hui.', steps: [{ text: 'Écris ci-dessous, une idée par ligne.' }], write: { prompts: ['Première bonne chose', 'Deuxième bonne chose', 'Troisième bonne chose'], keep: true } },
  { id: 'soucis', name: 'Heure des soucis', kind: 'écriture', minutes: 5, intro: 'Sortir un souci de sa tête pour le poser sur le papier. Ce texte n\'est PAS enregistré.', steps: [{ text: 'Écris ce qui te préoccupe, puis ce que tu peux faire dès maintenant, et ce qui ne dépend pas de toi.' }], write: { prompts: ['Ce qui me préoccupe', 'Ce que je peux faire maintenant (une petite action)', 'Ce qui ne dépend pas de moi'], keep: false } },
  { id: 'lettre', name: 'Lettre à soi-même', kind: 'écriture', minutes: 5, intro: 'Écris-toi comme tu écrirais à un ami qui vit la même chose. Ce texte n\'est PAS enregistré.', steps: [{ text: 'Prends ton temps, sois aussi gentil·le avec toi qu\'avec un ami.' }], write: { prompts: ['Cher·e moi…'], keep: false } },
];
