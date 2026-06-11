-- ============================================================
--  DONNÉES D'EXEMPLE (les utilisateurs sont créés par db/init.js
--  avec des mots de passe hashés)
-- ============================================================

INSERT INTO ingredients (nom, unite) VALUES
    ('Knacks',      'pièce'),
    ('Pain',        'pièce'),
    ('Moutarde',    'L'),
    ('Pâte à tarte','pièce'),
    ('Crème',       'L'),
    ('Lardons',     'kg'),
    ('Oignons',     'kg'),
    ('Café (dose)', 'pièce'),
    ('Mignardises', 'pièce');

INSERT INTO materiels (nom, unite) VALUES
    ('Réchaud à knack',    'pièce'),
    ('Pince à knack',      'pièce'),
    ('Assiette plastique', 'pièce'),
    ('Bidon d''eau 5L',    'pièce'),
    ('Plaque tarte',       'pièce'),
    ('Planche à découper', 'pièce'),
    ('Gobelet plastique',  'pièce'),
    ('Nappe jetable',      'pièce');

INSERT INTO inventaire (materiel_id, quantite_stock, seuil_alerte)
SELECT m.id, q.stock, q.seuil FROM materiels m
JOIN (VALUES
        ('Réchaud à knack',    8,   2),
        ('Pince à knack',      12,  3),
        ('Assiette plastique', 300, 100),
        ('Bidon d''eau 5L',    15,  5),
        ('Plaque tarte',       3,   1),
        ('Planche à découper', 10,  2),
        ('Gobelet plastique',  200, 80),
        ('Nappe jetable',      40,  10)
     ) AS q(nom, stock, seuil) ON TRUE
WHERE m.nom = q.nom;

-- Recettes
INSERT INTO recettes (nom, description, portion_base) VALUES
    ('Knacks',        'Knacks chaudes, pain, moutarde. Service au réchaud.', 10),
    ('Tarte flambée', 'Tarte flambée alsacienne traditionnelle.',            10),
    ('Café gourmand', 'Café accompagné de mignardises.',                     10);

-- Helper : insère les lignes ingrédient d'une recette
INSERT INTO recette_ingredients (recette_id, ingredient_id, quantite)
SELECT r.id, i.id, q.quantite
FROM (VALUES
        ('Knacks','Knacks',20),('Knacks','Pain',10),('Knacks','Moutarde',0.2),
        ('Tarte flambée','Pâte à tarte',5),('Tarte flambée','Crème',1),
        ('Tarte flambée','Lardons',0.5),('Tarte flambée','Oignons',0.4),
        ('Café gourmand','Café (dose)',10),('Café gourmand','Mignardises',30)
     ) AS q(recette, ingredient, quantite)
JOIN recettes r    ON r.nom = q.recette
JOIN ingredients i ON i.nom = q.ingredient;

-- Lignes matériel (avec mode et capacité)
INSERT INTO recette_materiels (recette_id, materiel_id, mode, quantite, capacite)
SELECT r.id, m.id, q.mode::mode_echelle, q.quantite, q.capacite
FROM (VALUES
        ('Knacks','Réchaud à knack','par_palier',1,50),
        ('Knacks','Pince à knack','par_palier',1,50),
        ('Knacks','Assiette plastique','proportionnel',10,NULL),
        ('Knacks','Bidon d''eau 5L','proportionnel',1,NULL),
        ('Tarte flambée','Plaque tarte','par_palier',1,40),
        ('Tarte flambée','Planche à découper','par_palier',1,50),
        ('Tarte flambée','Assiette plastique','proportionnel',10,NULL),
        ('Café gourmand','Gobelet plastique','proportionnel',10,NULL),
        ('Café gourmand','Assiette plastique','proportionnel',10,NULL)
     ) AS q(recette, materiel, mode, quantite, capacite)
JOIN recettes r   ON r.nom = q.recette
JOIN materiels m  ON m.nom = q.materiel;

-- Commandes d'exemple (juin 2026)
INSERT INTO commandes (client, date_event, notes) VALUES
    ('Anniversaire Muller', DATE '2026-06-12', 'Buffet midi'),
    ('Mariage Schmitt',     DATE '2026-06-14', 'Grand événement'),
    ('CE Durand',           DATE '2026-06-20', 'Buffet midi'),
    ('Fête des voisins',    DATE '2026-06-28', 'Très gros volume');

INSERT INTO commande_recettes (commande_id, recette_id, nb_personnes)
SELECT c.id, r.id, q.nb
FROM (VALUES
        ('Anniversaire Muller','Knacks',30),
        ('Mariage Schmitt','Tarte flambée',120),
        ('Mariage Schmitt','Café gourmand',120),
        ('CE Durand','Knacks',50),
        ('Fête des voisins','Knacks',400)
     ) AS q(client, recette, nb)
JOIN commandes c ON c.client = q.client
JOIN recettes  r ON r.nom    = q.recette;
