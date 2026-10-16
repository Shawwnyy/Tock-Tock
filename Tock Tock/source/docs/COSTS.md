# Coûts estimés des services externes

> Relevés le 16/10/2026 sur les pages publiques consultées pendant la création du projet ; **les tarifs changent : vérifiez avant de vous engager.** Les montants en dollars sont ceux affichés par les fournisseurs.

| Service | Gratuit | Limite à surveiller | Payant (indicatif) |
|---|---|---|---|
| **Supabase** (base, auth, stockage, fonctions) | 500 Mo de base · 1 Go de fichiers (50 Mo/fichier) · 5 Go de sortie · 50 000 membres actifs/mois · 500 000 appels de fonctions/mois | **Pause automatique après ~7 jours sans activité** · pas de sauvegardes quotidiennes incluses · 50 Mo par fichier = plafond vidéo | Plan Pro à partir d'environ 25 $/mois (à vérifier) : plus de stockage/sortie, sauvegardes, pas de pause |
| **Resend** (e-mails) | 100 e-mails/jour · 3 000/mois · 3 domaines | Le plafond **100/jour** limite les envois de chroniques : au-delà, les e-mails échouent et sont retentés (3 essais) | Pro 20 $/mois : 50 000 e-mails/mois sans limite quotidienne |
| **GitHub Pages** | Gratuit pour un dépôt public (limites d'usage raisonnable) | Dépôt privé : selon l'offre GitHub | — |
| **IA** (optionnelle) | — | Facturation à l'usage (jetons). Une chronique ≈ quelques centaines à ~2 000 jetons ; garde-fous : 3–5 générations/jour/personne, assistant 100 messages/jour/personne, réponses plafonnées | Dépend du modèle : consultez la page tarifaire du fournisseur choisi ; ordre de grandeur de **quelques centimes par membre actif et par mois** avec un petit modèle (estimation, non mesurée) |
| **Antivirus / modération d'images** | — | Non implémenté | Service tiers ou ClamAV auto-hébergé (coût d'un serveur) |
| **SMS** (code de connexion) | — | Écrit mais désactivé par défaut ; chaque code est un SMS facturé par le fournisseur (voir LIMITS.md pour la fraude au trafic) | Facturation à l'unité par un opérateur (de quelques centimes par SMS ; plus cher selon le pays et l'obligation d'expéditeur déclaré) |
| **Nom de domaine** (recommandé pour les e-mails) | — | Requis pour Resend en production (SPF/DKIM) | ≈ 10–15 €/an |

## Ce qui sature en premier
1. **Stockage de fichiers** (1 Go) si les médias sont ouverts largement : quota par membre fixé à 100 Mo, ajustable dans `app_config` ; en pratique prévoyez moins.
2. **E-mails** (100/jour) dès ~100 membres avec envoi quotidien.
3. **Pause du projet gratuit** si personne ne se connecte pendant une semaine : bloquant pour un service de bien-être → prévoir le plan Pro dès l'ouverture publique.
