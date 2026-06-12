# API Traiteur

Backend de gestion logistique pour traiteur : recettes, matériel, inventaire et
commandes, avec calcul automatique des besoins (matériel + cuisine) selon le
nombre de couverts, ajustements manuels par commande, et alertes de stock.

## Stack

- **Node.js** + **Express** (API REST)
- **PostgreSQL** (données + calculs via vues SQL)
- **JWT** + **bcrypt** (authentification, rôles manager / préparateur)

## Structure

```
backend/
├── package.json
├── .env.example
├── db/
│   ├── schema.sql      Schéma complet (tables, enums, vues de calcul)
│   ├── seed.sql        Données d'exemple (recettes, matériel, commandes)
│   └── init.js         Réinitialise la base + crée 2 comptes de démo
└── src/
    ├── db.js           Pool PostgreSQL
    ├── auth.js         Hash, JWT, middlewares (authMiddleware, requireManager)
    ├── ah.js           Wrapper d'erreurs async
    ├── server.js       Montage des routes + gestion d'erreurs
    └── routes/
        ├── auth.js         Connexion
        ├── catalogue.js    Ingrédients, matériel, inventaire, alertes
        ├── recettes.js     CRUD recettes
        └── commandes.js    Calendrier, détail calculé, ajustements
```

## Démarrage

```bash
cd backend
cp .env.example .env          # adapter DATABASE_URL et JWT_SECRET
npm install
npm run init-db               # crée le schéma, les données et les comptes démo
npm start                     # API sur http://localhost:3000
```

`init-db` crée deux comptes de démonstration (un **manager** et un **préparateur**).
Les identifiants ne sont **pas** publiés ici : ils sont fournis séparément et doivent
être changés (mot de passe) avant toute exposition publique de l'API.

## Modèle de données (logique clé)

- Une **recette** définit ses besoins pour une **portion de base** (ex. 10 pers).
- Le **matériel** d'une recette se calcule de deux façons :
  - `proportionnel` → quantité × couverts ÷ portion_base (assiettes, eau…)
  - `par_palier` → `CEIL(couverts ÷ capacité) × quantité` (1 réchaud pour 50…)
- Les **ingrédients** (cuisine) sont toujours proportionnels ; ils ne sont pas suivis en stock.
- Le **matériel** est suivi dans l'**inventaire** (stock + seuil d'alerte par article).
- Une **commande** = une date + plusieurs recettes, chacune avec son nombre de couverts.
- Des **ajustements manuels** par commande permettent de modifier une quantité
  calculée ou d'ajouter un matériel supplémentaire (extra), sans toucher la recette.

Le calcul final est exposé par les vues `besoins_materiel_effectif`,
`besoins_ingredients_effectif` et `commande_statut` (statut `ok` / `juste` / `court`
selon la couverture du stock).

## Authentification

Toutes les routes sous `/api` (sauf `/api/auth/login`) exigent un en-tête :

```
Authorization: Bearer <token>
```

Le token s'obtient via `POST /api/auth/login`. Les routes de création / modification
sont réservées au rôle **manager**.

## Endpoints

### Auth
| Méthode | Route             | Accès   | Description                    |
|---------|-------------------|---------|--------------------------------|
| POST    | /api/auth/login   | public  | Renvoie un token + utilisateur |

### Catalogue
| Méthode | Route                              | Accès   | Description                     |
|---------|------------------------------------|---------|---------------------------------|
| GET     | /api/ingredients                   | connecté| Liste des ingrédients           |
| POST    | /api/ingredients                   | manager | Créer un ingrédient             |
| GET     | /api/materiels                     | connecté| Matériel + stock                |
| POST    | /api/materiels                     | manager | Créer un matériel (+ inventaire)|
| PUT     | /api/materiels/:id/inventaire      | manager | Mettre à jour stock / seuil     |
| GET     | /api/inventaire                    | connecté| État du stock (+ en_alerte)     |
| GET     | /api/alertes                       | connecté| Matériel sous le seuil          |

### Recettes
| Méthode | Route               | Accès   | Description                          |
|---------|---------------------|---------|--------------------------------------|
| GET     | /api/recettes       | connecté| Liste des recettes                   |
| GET     | /api/recettes/:id   | connecté| Détail (ingrédients + matériel)      |
| POST    | /api/recettes       | manager | Créer une recette                    |
| PUT     | /api/recettes/:id   | manager | Modifier une recette                 |
| DELETE  | /api/recettes/:id   | manager | Supprimer une recette                |

### Commandes
| Méthode | Route                                       | Accès   | Description                               |
|---------|---------------------------------------------|---------|-------------------------------------------|
| GET     | /api/commandes?from=&to=                    | connecté| Liste (calendrier) + statut + couverts    |
| GET     | /api/commandes/:id                          | connecté| Détail : recettes + besoins effectifs     |
| POST    | /api/commandes                              | manager | Créer une commande                        |
| PUT     | /api/commandes/:id                          | manager | Modifier en-tête + recettes               |
| DELETE  | /api/commandes/:id                          | manager | Supprimer une commande                    |
| PUT     | /api/commandes/:id/materiel/:materielId     | manager | Ajuster / ajouter une quantité matériel   |
| DELETE  | /api/commandes/:id/materiel/:materielId     | manager | Retirer l'ajustement (retour au calcul)   |
| PUT     | /api/commandes/:id/cuisine/:ingredientId    | manager | Ajuster une quantité cuisine              |
| DELETE  | /api/commandes/:id/cuisine/:ingredientId    | manager | Retirer l'ajustement cuisine              |

## Exemples d'appels

Connexion :
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>","mot_de_passe":"<mot_de_passe>"}'
```

Calendrier de juin :
```bash
curl "http://localhost:3000/api/commandes?from=2026-06-01&to=2026-06-30" \
  -H "Authorization: Bearer <token>"
```

Détail d'une commande (besoins calculés + statut stock) :
```bash
curl http://localhost:3000/api/commandes/3 -H "Authorization: Bearer <token>"
```

Forcer 350 assiettes sur la commande 3 (ajustement manuel) :
```bash
curl -X PUT http://localhost:3000/api/commandes/3/materiel/3 \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"quantite":350}'
```

## État du projet

- ✅ Schéma et vues de calcul **validés sur PostgreSQL** (prorata, palier,
  ajustements, statut de couverture du stock).
- ✅ Code des routes en place et vérifié syntaxiquement.
- ⏳ À faire côté infra : exécuter `npm run init-db` puis `npm start` dans
  l'environnement cible pour valider la couche HTTP de bout en bout.
