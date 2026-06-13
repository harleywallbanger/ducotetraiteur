-- ============================================================
--  APPLICATION TRAITEUR — Schéma complet (PostgreSQL)
--  Lancé par `npm run init-db` (qui réinitialise le schéma public).
-- ============================================================

-- Réinitialisation compatible PostgreSQL managé.
-- (On évite « DROP SCHEMA public », qui exige d'être propriétaire du schéma —
--  ce que l'utilisateur d'un add-on managé n'est pas.)
-- On supprime directement les objets : le CASCADE sur les tables emporte les vues qui en dépendent.
DROP TABLE IF EXISTS
    commande_ingredients_ajust,
    commande_materiels_ajust,
    commande_recettes,
    commandes,
    inventaire,
    recette_materiels,
    recette_ingredients,
    recettes,
    materiels,
    ingredients,
    utilisateurs
CASCADE;

DROP TYPE IF EXISTS mode_echelle      CASCADE;
DROP TYPE IF EXISTS role_utilisateur  CASCADE;

-- ---------- UTILISATEURS ----------
CREATE TYPE role_utilisateur AS ENUM ('admin', 'manager', 'chef', 'cuisinier', 'preparateur');

CREATE TABLE utilisateurs (
    id            BIGSERIAL PRIMARY KEY,
    nom           TEXT             NOT NULL,
    email         TEXT             NOT NULL UNIQUE,
    mot_de_passe  TEXT             NOT NULL,           -- toujours stocké hashé
    role          role_utilisateur NOT NULL DEFAULT 'preparateur',
    bloque        BOOLEAN          NOT NULL DEFAULT false,
    cree_le       TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- ---------- INGRÉDIENTS (cuisine, in/out, pas de stock) ----------
CREATE TABLE ingredients (
    id    BIGSERIAL PRIMARY KEY,
    nom   TEXT NOT NULL UNIQUE,
    unite TEXT NOT NULL
);

-- ---------- MATÉRIEL (logistique, suivi en stock) ----------
CREATE TABLE materiels (
    id    BIGSERIAL PRIMARY KEY,
    nom   TEXT NOT NULL UNIQUE,
    unite TEXT NOT NULL
);

-- ---------- RECETTES ----------
CREATE TABLE recettes (
    id           BIGSERIAL PRIMARY KEY,
    nom          TEXT        NOT NULL UNIQUE,
    description  TEXT,
    portion_base INTEGER     NOT NULL DEFAULT 10 CHECK (portion_base > 0),
    cree_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recette_ingredients (
    recette_id    BIGINT  NOT NULL REFERENCES recettes(id)    ON DELETE CASCADE,
    ingredient_id BIGINT  NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    quantite      NUMERIC NOT NULL CHECK (quantite >= 0),
    PRIMARY KEY (recette_id, ingredient_id)
);

-- Mode de calcul du matériel selon le nombre de couverts
CREATE TYPE mode_echelle AS ENUM ('proportionnel', 'par_palier');

CREATE TABLE recette_materiels (
    recette_id  BIGINT       NOT NULL REFERENCES recettes(id)  ON DELETE CASCADE,
    materiel_id BIGINT       NOT NULL REFERENCES materiels(id) ON DELETE RESTRICT,
    mode        mode_echelle NOT NULL DEFAULT 'proportionnel',
    quantite    NUMERIC      NOT NULL CHECK (quantite >= 0),
    capacite    INTEGER      CHECK (capacite IS NULL OR capacite > 0),
    CONSTRAINT capacite_coherente CHECK (
        (mode = 'par_palier'    AND capacite IS NOT NULL) OR
        (mode = 'proportionnel' AND capacite IS NULL)
    ),
    PRIMARY KEY (recette_id, materiel_id)
);

-- ---------- INVENTAIRE (uniquement le matériel) ----------
CREATE TABLE inventaire (
    materiel_id    BIGINT  PRIMARY KEY REFERENCES materiels(id) ON DELETE CASCADE,
    quantite_stock NUMERIC NOT NULL DEFAULT 0 CHECK (quantite_stock >= 0),
    seuil_alerte   NUMERIC NOT NULL DEFAULT 0 CHECK (seuil_alerte >= 0)
);

-- ---------- COMMANDES ----------
CREATE TABLE commandes (
    id          BIGSERIAL PRIMARY KEY,
    client      TEXT,
    date_event  DATE        NOT NULL,
    notes       TEXT,
    adresse     TEXT,
    contact_nom TEXT,
    contact_tel TEXT,
    cree_par    BIGINT      REFERENCES utilisateurs(id),
    cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE commande_recettes (
    commande_id  BIGINT  NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
    recette_id   BIGINT  NOT NULL REFERENCES recettes(id)  ON DELETE RESTRICT,
    nb_personnes INTEGER NOT NULL CHECK (nb_personnes > 0),
    PRIMARY KEY (commande_id, recette_id)
);

-- Ajustements manuels par commande :
--   override d'une quantité calculée, OU matériel/ingrédient ajouté en plus.
CREATE TABLE commande_materiels_ajust (
    commande_id BIGINT  NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
    materiel_id BIGINT  NOT NULL REFERENCES materiels(id) ON DELETE CASCADE,
    quantite    NUMERIC NOT NULL CHECK (quantite >= 0),
    PRIMARY KEY (commande_id, materiel_id)
);
CREATE TABLE commande_ingredients_ajust (
    commande_id   BIGINT  NOT NULL REFERENCES commandes(id)   ON DELETE CASCADE,
    ingredient_id BIGINT  NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    quantite      NUMERIC NOT NULL CHECK (quantite >= 0),
    PRIMARY KEY (commande_id, ingredient_id)
);

CREATE INDEX idx_recette_ingredients_ingredient ON recette_ingredients(ingredient_id);
CREATE INDEX idx_recette_materiels_materiel     ON recette_materiels(materiel_id);
CREATE INDEX idx_commande_recettes_recette      ON commande_recettes(recette_id);
CREATE INDEX idx_commandes_date                 ON commandes(date_event);


-- ============================================================
--  VUES — calcul automatique (avant ajustements)
-- ============================================================
CREATE VIEW besoins_materiel_commande AS
SELECT
    cr.commande_id,
    rm.materiel_id,
    m.nom AS materiel,
    m.unite,
    SUM(
        CASE rm.mode
            WHEN 'proportionnel' THEN rm.quantite * cr.nb_personnes::NUMERIC / r.portion_base
            WHEN 'par_palier'    THEN CEIL(cr.nb_personnes::NUMERIC / rm.capacite) * rm.quantite
        END
    ) AS quantite_totale
FROM commande_recettes cr
JOIN recettes          r  ON r.id  = cr.recette_id
JOIN recette_materiels rm ON rm.recette_id = r.id
JOIN materiels         m  ON m.id  = rm.materiel_id
GROUP BY cr.commande_id, rm.materiel_id, m.nom, m.unite;

CREATE VIEW besoins_ingredients_commande AS
SELECT
    cr.commande_id,
    ri.ingredient_id,
    i.nom AS ingredient,
    i.unite,
    SUM(ri.quantite * cr.nb_personnes::NUMERIC / r.portion_base) AS quantite_totale
FROM commande_recettes    cr
JOIN recettes             r  ON r.id  = cr.recette_id
JOIN recette_ingredients  ri ON ri.recette_id = r.id
JOIN ingredients          i  ON i.id  = ri.ingredient_id
GROUP BY cr.commande_id, ri.ingredient_id, i.nom, i.unite;


-- ============================================================
--  VUES — besoins EFFECTIFS (calcul auto + ajustements manuels)
-- ============================================================
CREATE VIEW besoins_materiel_effectif AS
WITH toutes AS (
    SELECT commande_id, materiel_id FROM besoins_materiel_commande
    UNION
    SELECT commande_id, materiel_id FROM commande_materiels_ajust
)
SELECT
    t.commande_id,
    t.materiel_id,
    m.nom   AS materiel,
    m.unite,
    COALESCE(aj.quantite, a.quantite_totale, 0)        AS quantite,
    a.quantite_totale                                  AS quantite_auto,
    (aj.quantite IS NOT NULL)                          AS ajuste,
    (a.commande_id IS NULL)                            AS extra,
    COALESCE(inv.quantite_stock, 0)                    AS stock,
    GREATEST(COALESCE(aj.quantite, a.quantite_totale, 0) - COALESCE(inv.quantite_stock, 0), 0) AS manque
FROM toutes t
JOIN materiels m  ON m.id = t.materiel_id
LEFT JOIN besoins_materiel_commande a
       ON a.commande_id = t.commande_id AND a.materiel_id = t.materiel_id
LEFT JOIN commande_materiels_ajust aj
       ON aj.commande_id = t.commande_id AND aj.materiel_id = t.materiel_id
LEFT JOIN inventaire inv ON inv.materiel_id = t.materiel_id;

CREATE VIEW besoins_ingredients_effectif AS
WITH toutes AS (
    SELECT commande_id, ingredient_id FROM besoins_ingredients_commande
    UNION
    SELECT commande_id, ingredient_id FROM commande_ingredients_ajust
)
SELECT
    t.commande_id,
    t.ingredient_id,
    i.nom   AS ingredient,
    i.unite,
    COALESCE(aj.quantite, a.quantite_totale, 0) AS quantite,
    a.quantite_totale                           AS quantite_auto,
    (aj.quantite IS NOT NULL)                   AS ajuste,
    (a.commande_id IS NULL)                     AS extra
FROM toutes t
JOIN ingredients i ON i.id = t.ingredient_id
LEFT JOIN besoins_ingredients_commande a
       ON a.commande_id = t.commande_id AND a.ingredient_id = t.ingredient_id
LEFT JOIN commande_ingredients_ajust aj
       ON aj.commande_id = t.commande_id AND aj.ingredient_id = t.ingredient_id;


-- ============================================================
--  VUES — alertes & statut
-- ============================================================
CREATE VIEW alertes_stock AS
SELECT m.id AS materiel_id, m.nom AS materiel, inv.quantite_stock, inv.seuil_alerte, m.unite
FROM inventaire inv
JOIN materiels m ON m.id = inv.materiel_id
WHERE inv.quantite_stock < inv.seuil_alerte;

-- Statut d'une commande selon la couverture du stock par le matériel
CREATE VIEW commande_statut AS
SELECT
    c.id AS commande_id,
    CASE
        WHEN bool_or(e.quantite >  e.stock)        THEN 'court'
        WHEN bool_or(e.quantite >= e.stock * 0.9)  THEN 'juste'
        ELSE 'ok'
    END AS statut
FROM commandes c
LEFT JOIN besoins_materiel_effectif e ON e.commande_id = c.id
GROUP BY c.id;
