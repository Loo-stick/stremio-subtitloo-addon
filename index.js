/**
 * Addon Stremio - Subtitles FR (Multi-sources)
 *
 * Point d'entrée de l'addon Stremio pour récupérer
 * des sous-titres français depuis plusieurs sources:
 * - OpenSubtitles
 * - SubDL
 *
 * @module index
 */

require('dotenv').config();

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const OpenSubtitlesClient = require('./lib/opensubtitles');
const SubDLClient = require('./lib/subdl');

// Configuration des variables d'environnement
const OS_API_KEY = process.env.OPENSUBTITLES_API_KEY;
const OS_USER_AGENT = process.env.OPENSUBTITLES_USER_AGENT || 'stremio-subtitles-fr v1.0';
const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
const PORT = parseInt(process.env.PORT, 10) || 7000;

// Initialisation des clients (optionnels)
let osClient = null;
let subdlClient = null;

// Vérification qu'au moins une source est configurée
const sources = [];

if (OS_API_KEY && OS_API_KEY !== 'your_api_key_here') {
    osClient = new OpenSubtitlesClient(OS_API_KEY, OS_USER_AGENT);
    sources.push('OpenSubtitles');
    console.log('[Addon] Source activée: OpenSubtitles');
}

if (SUBDL_API_KEY && SUBDL_API_KEY !== 'your_api_key_here') {
    subdlClient = new SubDLClient(SUBDL_API_KEY);
    sources.push('SubDL');
    console.log('[Addon] Source activée: SubDL');
}

if (sources.length === 0) {
    console.error('[Addon] Erreur: Aucune source configurée!');
    console.error('[Addon] Configurez au moins OPENSUBTITLES_API_KEY ou SUBDL_API_KEY dans .env');
    process.exit(1);
}

/**
 * Manifest de l'addon Stremio
 *
 * Définit les métadonnées et capacités de l'addon.
 */
const manifest = {
    id: 'community.subtitles.fr',
    version: '1.1.0',
    name: 'Subtitles FR',
    description: `Sous-titres français (${sources.join(' + ')})`,
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
 * Recherche en parallèle sur toutes les sources activées.
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

        // Recherche en parallèle sur toutes les sources
        const searchPromises = [];

        if (osClient) {
            searchPromises.push(searchOpenSubtitles(parsed));
        }

        if (subdlClient) {
            searchPromises.push(searchSubDL(parsed));
        }

        // Attend tous les résultats
        const results = await Promise.all(searchPromises);

        // Combine les résultats
        const allSubtitles = results.flat();

        if (allSubtitles.length === 0) {
            console.log('[Addon] Aucun sous-titre trouvé sur aucune source');
            return { subtitles: [] };
        }

        console.log(`[Addon] Total: ${allSubtitles.length} sous-titre(s) combinés`);
        return { subtitles: allSubtitles };

    } catch (error) {
        console.error('[Addon] Erreur handler sous-titres:', error.message);
        return { subtitles: [] };
    }
});

/**
 * Recherche des sous-titres sur OpenSubtitles
 *
 * @param {Object} parsed - Informations parsées du contenu
 * @returns {Promise<Array>} Sous-titres formatés pour Stremio
 */
async function searchOpenSubtitles(parsed) {
    try {
        const subtitles = await osClient.searchSubtitles({
            imdbId: parsed.imdbId,
            type: parsed.type,
            season: parsed.season,
            episode: parsed.episode
        });

        if (subtitles.length === 0) {
            return [];
        }

        return await osClient.formatForStremio(subtitles);
    } catch (error) {
        console.error('[Addon] Erreur OpenSubtitles:', error.message);
        return [];
    }
}

/**
 * Recherche des sous-titres sur SubDL
 *
 * @param {Object} parsed - Informations parsées du contenu
 * @returns {Promise<Array>} Sous-titres formatés pour Stremio
 */
async function searchSubDL(parsed) {
    try {
        const subtitles = await subdlClient.searchSubtitles({
            imdbId: parsed.imdbId,
            type: parsed.type,
            season: parsed.season,
            episode: parsed.episode
        });

        if (subtitles.length === 0) {
            return [];
        }

        return subdlClient.formatForStremio(subtitles);
    } catch (error) {
        console.error('[Addon] Erreur SubDL:', error.message);
        return [];
    }
}

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
console.log(`[Addon] Subtitles FR Addon démarré!`);
console.log(`[Addon] Sources: ${sources.join(', ')}`);
console.log(`[Addon] Port: ${PORT}`);
console.log(`[Addon] URL: http://localhost:${PORT}/manifest.json`);
console.log(`[Addon] ========================================\n`);
console.log(`[Addon] Pour installer dans Stremio:`);
console.log(`[Addon] 1. Ouvrez Stremio`);
console.log(`[Addon] 2. Allez dans Addons > Community Addons`);
console.log(`[Addon] 3. Collez: http://localhost:${PORT}/manifest.json`);
console.log(`[Addon] ========================================\n`);
