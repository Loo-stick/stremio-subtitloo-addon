/**
 * Addon Stremio - OpenSubtitles FR
 *
 * Point d'entrée de l'addon Stremio pour récupérer
 * des sous-titres français depuis OpenSubtitles.
 *
 * @module index
 */

require('dotenv').config();

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const OpenSubtitlesClient = require('./lib/opensubtitles');

// Validation des variables d'environnement
const API_KEY = process.env.OPENSUBTITLES_API_KEY;
const USER_AGENT = process.env.OPENSUBTITLES_USER_AGENT || 'stremio-subtitles-fr v1.0';
const PORT = parseInt(process.env.PORT, 10) || 7000;

if (!API_KEY || API_KEY === 'your_api_key_here') {
    console.error('[Addon] Erreur: OPENSUBTITLES_API_KEY non configurée dans .env');
    process.exit(1);
}

// Initialisation du client OpenSubtitles
const osClient = new OpenSubtitlesClient(API_KEY, USER_AGENT);

/**
 * Manifest de l'addon Stremio
 *
 * Définit les métadonnées et capacités de l'addon.
 */
const manifest = {
    id: 'community.opensubtitles.fr',
    version: '1.0.0',
    name: 'OpenSubtitles FR',
    description: 'Sous-titres français depuis OpenSubtitles',
    logo: 'https://www.opensubtitles.org/favicon.ico',
    catalogs: [],
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    behaviorHints: {
        configurable: false,
        configurationRequired: false
    }
};

// Création du builder d'addon
const builder = new addonBuilder(manifest);

/**
 * Handler pour les requêtes de sous-titres
 *
 * Appelé par Stremio quand l'utilisateur regarde un contenu
 * et demande les sous-titres disponibles.
 *
 * @param {Object} args - Arguments de la requête
 * @param {string} args.type - Type de contenu ('movie' ou 'series')
 * @param {string} args.id - Identifiant du contenu (format: tt1234567 ou tt1234567:1:2)
 * @returns {Promise<Object>} Objet contenant les sous-titres
 */
builder.defineSubtitlesHandler(async (args) => {
    const { type, id } = args;

    console.log(`\n[Addon] === Nouvelle requête sous-titres ===`);
    console.log(`[Addon] Type: ${type}, ID: ${id}`);

    try {
        // Parse l'ID pour extraire IMDB ID et infos de série
        const parsed = parseId(id, type);

        if (!parsed.imdbId) {
            console.log('[Addon] ID IMDB invalide');
            return { subtitles: [] };
        }

        console.log(`[Addon] IMDB ID: ${parsed.imdbId}`);

        // Recherche des sous-titres
        const subtitles = await osClient.searchSubtitles({
            imdbId: parsed.imdbId,
            type: parsed.type,
            season: parsed.season,
            episode: parsed.episode
        });

        if (subtitles.length === 0) {
            console.log('[Addon] Aucun sous-titre trouvé');
            return { subtitles: [] };
        }

        // Formate les sous-titres pour Stremio
        const formatted = await osClient.formatForStremio(subtitles);

        console.log(`[Addon] Retour de ${formatted.length} sous-titre(s)`);
        return { subtitles: formatted };

    } catch (error) {
        console.error('[Addon] Erreur handler sous-titres:', error.message);
        return { subtitles: [] };
    }
});

/**
 * Parse l'identifiant Stremio pour extraire les informations
 *
 * @param {string} id - Identifiant du contenu
 * @param {string} type - Type de contenu
 * @returns {Object} Informations parsées (imdbId, type, season, episode)
 */
function parseId(id, type) {
    const result = {
        imdbId: null,
        type: type,
        season: null,
        episode: null
    };

    if (!id) return result;

    // Format pour les séries: tt1234567:saison:episode
    if (type === 'series' && id.includes(':')) {
        const parts = id.split(':');
        result.imdbId = parts[0];
        result.season = parseInt(parts[1], 10) || null;
        result.episode = parseInt(parts[2], 10) || null;
    } else {
        // Format simple pour les films: tt1234567
        result.imdbId = id.split(':')[0];
    }

    // Validation format IMDB ID
    if (!result.imdbId || !result.imdbId.match(/^tt\d+$/)) {
        result.imdbId = null;
    }

    return result;
}

// Démarrage du serveur HTTP
serveHTTP(builder.getInterface(), { port: PORT });

console.log(`\n[Addon] ========================================`);
console.log(`[Addon] OpenSubtitles FR Addon démarré!`);
console.log(`[Addon] Port: ${PORT}`);
console.log(`[Addon] URL: http://localhost:${PORT}/manifest.json`);
console.log(`[Addon] ========================================\n`);
console.log(`[Addon] Pour installer dans Stremio:`);
console.log(`[Addon] 1. Ouvrez Stremio`);
console.log(`[Addon] 2. Allez dans Addons > Community Addons`);
console.log(`[Addon] 3. Collez: http://localhost:${PORT}/manifest.json`);
console.log(`[Addon] ========================================\n`);
