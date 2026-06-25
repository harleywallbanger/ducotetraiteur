// ============================================================================
//  Import catalogue « Du Côté Traiteur » — matériel + recettes
//  Lecture des fiches/bons de commande photographiés (à corriger librement).
//  - Tous les matériels sont créés avec un stock 0 (à ajuster dans l'onglet Stock).
//  - Les recettes sont des « coquilles » (nom + description) : il restera à leur
//    associer ingrédients / matériel / quantités de base dans l'éditeur de recette.
//  - Exécution UNE SEULE FOIS au démarrage (marqueur _catalog_seed), idempotent.
//  - Les BOISSONS de la fiche ne sont volontairement pas importées ici : elles
//    relèvent du suivi sortie/retour (étape B2.2) et auront leur propre traitement.
// ============================================================================

const MATERIELS = [
  // ----- COFFRAGE -----
  ["Rlx Nappage Gris", "pièce"],
  ["Rlx Nappage", "pièce"],
  ["Rlx TAT couleur", "pièce"],
  ["Rlx Tissu", "pièce"],
  ["Serviettes non tissé 40x40", "pièce"],

  // ----- CAFÉ -----
  ["Machine à café inox", "pièce"],
  ["Thermos noire", "pièce"],
  ["Thermos blanche", "pièce"],
  ["Gobelet café", "pièce"],
  ["Tasse à café dur", "pièce"],
  ["Sous-tasse à café dur", "pièce"],
  ["Cuillère café inox", "pièce"],
  ["Tasse à café dur grande", "pièce"],
  ["Grande cuillère service", "pièce"],
  ["Café Nescafé", "pièce"],
  ["Sucre", "pièce"],
  ["Thé / Infusions", "pièce"],
  ["Chatine ou chocolat", "pièce"],
  ["Dosette ou litre de lait", "pièce"],
  ["Touillettes", "pièce"],

  // ----- PACKAGE CHAUD BUFFET -----
  ["Bain-marie élec", "pièce"],
  ["Bain-marie élec carré", "pièce"],
  ["Bain-marie élec rond", "pièce"],
  ["Wok", "pièce"],
  ["Wok grand bain-marie", "pièce"],
  ["Chauffante à knack petite", "pièce"],
  ["Couvert salade", "pièce"],
  ["Pince à knack", "pièce"],
  ["Louche", "pièce"],
  ["Pelle à tarte", "pièce"],
  ["Rallonge électrique", "pièce"],
  ["Cuillère moutarde", "pièce"],
  ["Carton knack", "pièce"],
  ["Assiette carton pulpe", "pièce"],
  ["Corbeille osier grande", "pièce"],
  ["Corbeille osier moyenne", "pièce"],
  ["Bac gastro 1/1", "pièce"],
  ["Bac gastro 1/2", "pièce"],
  ["Plateau de service", "pièce"],
  ["Fourchette picnic", "pièce"],
  ["Couteau picnic", "pièce"],
  ["Carafe à jus 1L", "pièce"],
  ["Bonbonne à cocktail", "pièce"],
  ["Bain-marie à pat", "pièce"],
  ["Brûleur pour bain-marie", "pièce"],

  // ----- SERVICE BUFFET / DÉCO -----
  ["Plaque cuisson", "pièce"],
  ["Chariot assiette chauffant", "pièce"],
  ["Étuve électrique", "pièce"],
  ["Congélateur", "pièce"],
  ["Four électrique noir", "pièce"],
  ["Plancha", "pièce"],
  ["Plaque + poêle wok", "pièce"],
  ["Planche bois + couteau", "pièce"],
  ["Crêpière", "pièce"],
  ["Caisse blanche", "pièce"],
  ["Caisse jaune", "pièce"],
  ["Caisse bleue", "pièce"],
  ["Caisse barquette", "pièce"],
  ["Sac poubelle", "pièce"],
  ["Serviettes cocktail", "pièce"],
  ["Vasque + glace", "pièce"],
  ["Boîte hauteur", "pièce"],
  ["Décoration fleur", "pièce"],

  // ----- COUVERTS INOX -----
  ["Grand couteau", "pièce"],
  ["Grande fourchette", "pièce"],
  ["Couteau entremet", "pièce"],
  ["Fourchette entremet", "pièce"],
  ["Cuillère entremet", "pièce"],
  ["Assiette diam 27", "pièce"],
  ["Assiette diam 20", "pièce"],
  ["Assiette galice / velouté", "pièce"],

  // ----- FICHE NOURRITURE -----
  ["Dosette sel / poivre", "pièce"],
  ["Ménagère sel / poivre", "pièce"],
  ["Grignons salés boîte", "pièce"],
  ["Chips", "pièce"],

  // ----- VERRERIE -----
  ["Verre Inao", "pièce"],
  ["Flûte", "pièce"],
  ["Verre à bière", "pièce"],
  ["Verre à eau", "pièce"],

  // ----- BIÈRE (matériel) -----
  ["Tirage à bière Blade", "pièce"],
  ["Tirage bière + CO2", "pièce"],
  ["Caisse rouge", "pièce"],
  ["Poubelle déchet + seaux", "pièce"],

  // ----- GRILLADES EXTÉRIEURES -----
  ["Barbecue + accessoire", "pièce"],
  ["Brasero", "pièce"],
  ["Four tarte flambée", "pièce"],
  ["Seau + brosse + pâte alu", "pièce"],

  // ----- MOBILIER -----
  ["Housse mange-debout", "pièce"],
  ["Mange-debout", "pièce"],
  ["Table rectangle", "pièce"],
  ["Paravent", "pièce"],

  // ----- MATÉRIEL POUR CUISINE -----
  ["Torchon", "pièce"],

  // ----- LINGE PLAT -----
  ["Nappe tissu 24x24", "pièce"],
  ["Nappe tissu 14x25", "pièce"],
  ["Nappe tissu 15x15", "pièce"],
  ["Serviette tissu", "pièce"],
];

const RECETTES = [
  // [nom, description]
  ["Canapés Du Côté Traiteur",
   "Saumon fumé et crème de raifort ; fromage frais et kiwi ; crevettes et rillette aux 2 saumons ; rosette et cornichon ; jambon fumé"],
  ["Bruschetta sur pain grillé à l'ail",
   "Tartare de tomate et mozzarella à l'origan"],
  ["Pic de jambon fumé et cube de melon charentais", ""],
  ["Pic de gambas aux épices et ananas rôti", ""],
  ["Pic de tomate cerise et mozzarella au pesto", ""],
  ["Bagel bretzel",
   "Crème de raifort, saumon fumé et oignons rouges ; cheese crème, pastrami et poivron confit"],
  ["Petit pain aux céréales", "Saumon poché et sauce tartare"],
  ["Mini panier craquant aux oignons",
   "Confit de légumes et bille de mozzarella au basilic"],
  ["Wrap",
   "Guacamole, nouille chinoise, carotte et salade ; poulet curry, salade, tomate et oignon rouge"],
  ["Mini Bagnat", "Thon, tomate, salade et oignons"],
  ["Mini sandwich brioché",
   "Rôti de bœuf, béarnaise, tomate confite et roquette"],
  ["Club sandwich",
   "Thon, mayonnaise, salade et oignon ; tartare de légumes et tofu mariné"],
  ["Minicette gourmande",
   "Saumon fromage frais ciboulette ; salade océane ; jambon cru parmesan ; fromage frais tomate cerise marinée ; salade italienne"],
  ["Macaron salé végétarien", ""],
  ["Verrine — tartare de saumon au citron vert", ""],
  ["Les Fraîch'salades",
   "Tartare de tomates et roquette au vinaigre balsamique ; salade fraîcheur (avocat, mangue, tomate cerise, oignon rouge et coriandre frais)"],
  ["Salade fraîcheur",
   "Avocat, mangue, tomate cerise, oignon rouge et coriandre frais"],
  ["Émincé de dinde sauce champignons", "Avec mini spaetzles"],
  ["Risotto aux petits légumes et champignons", ""],
  ["Le Fromager", "Assortiment de fromages tranchés ; pain aux noix"],
  ["Les Mignardises sucrées", "Pâtisserie Stein"],
  ["Mini paniers de fruits", ""],
  ["Macarons pâtissiers", ""],
  ["Verrine gourmande", "Mousse chocolat au lait"],
  ["Verrine panna cotta aux fruits rouges", ""],
  ["Bar à fruits frais coupés", ""],
  ["Mini choux colorés", ""],
  ["Petites parts de tarte aux fruits de saison", ""],
  ["Mini viennoiseries", "Pain au chocolat, croissant, escargot"],
  ["Kougelhopf sucré", "≈ 1,5 tranche par personne"],
  ["Natte sucrée", "≈ 1,5 tranche par personne"],
];

async function seedCatalog(pool) {
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS _catalog_seed (id INTEGER PRIMARY KEY)");
    const done = await pool.query("SELECT 1 FROM _catalog_seed WHERE id = 1");
    if (done.rows.length) return; // déjà importé

    for (const [nom, unite] of MATERIELS) {
      await pool.query(
        "INSERT INTO materiels (nom, unite) VALUES ($1, $2) ON CONFLICT (nom) DO NOTHING",
        [nom, unite]);
      await pool.query(
        "INSERT INTO inventaire (materiel_id, quantite_stock, seuil_alerte) " +
        "SELECT id, 0, 0 FROM materiels WHERE nom = $1 ON CONFLICT (materiel_id) DO NOTHING",
        [nom]);
    }
    for (const [nom, description] of RECETTES) {
      await pool.query(
        "INSERT INTO recettes (nom, description, portion_base) VALUES ($1, $2, 10) ON CONFLICT (nom) DO NOTHING",
        [nom, description || null]);
    }
    await pool.query("INSERT INTO _catalog_seed (id) VALUES (1) ON CONFLICT DO NOTHING");
    console.log("Seed catalogue : termine (" + MATERIELS.length + " materiels, " + RECETTES.length + " recettes)");
  } catch (e) {
    console.error("Seed catalogue : echec", e.message);
  }
}

module.exports = seedCatalog;
