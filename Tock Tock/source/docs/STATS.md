# Calcul des moyennes (spécification et tests)

Implémentation : `supabase/functions/_shared/stats.ts` — fonctions pures, utilisées **à l'identique** par l'interface et par les Edge Functions. Tests : `tests/stats.test.ts`.

1. **Mise sur 10.** Une réponse d'échelle `[min, max]` vaut `(v − min) / (max − min) × 10`. Une échelle 0-10 reste inchangée ; une échelle 1-5 devient comparable. Une valeur hors échelle est ignorée (elle ne fausse pas la moyenne).
2. **Une réponse vide n'est jamais un zéro.** Une question non remplie n'existe pas en base (la ligne est supprimée) ; un vrai « 0 » saisi est compté comme 0.
3. **Moyenne d'une catégorie** = moyenne des réponses numériques valides de la catégorie. Sans réponse valide : pas de moyenne (`null`), pas « 0 ».
4. **Moyenne générale** = moyenne des moyennes de catégories **ayant des données**. Une catégorie de 8 questions pèse autant qu'une catégorie de 2.
5. **Exclus de toute moyenne :** réponses texte, oui/non, choix sans note, indicateurs dont « Dans la moyenne » est désactivé, et la **douleur** (colonnes séparées du bilan).
6. **« Moyenne indisponible »** si aucune réponse numérique valide : jamais de « 0 » de remplacement.
7. **Aucun arrondi dans les calculs**, seulement à l'affichage (1 décimale, virgule française).
8. **Séries et graphiques :** un jour sans bilan, ou sans donnée numérique, est un **trou** (`null`) dans la courbe. Les regroupements semaine/mois font la moyenne des **jours ayant des données** ; une période sans donnée reste vide.
9. **Indicateurs modifiés ou supprimés :** chaque réponse conserve un *instantané* de la définition de l'époque (nom, catégorie, échelle, notes des choix) : l'historique ne change pas rétroactivement.
10. L'interface affiche le détail du calcul (`explainAverage`) sous la moyenne du bilan.
