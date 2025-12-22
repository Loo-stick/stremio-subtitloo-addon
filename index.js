/**
 * Addon Stremio - Subtitles FR (Multi-sources)
 *
 * Point d'entrée de l'addon Stremio pour récupérer
 * des sous-titres français depuis plusieurs sources:
 * - OpenSubtitles (API key requise, proxy pour lazy download)
 * - SubDL (API key requise)
 * - YIFY (pas de clé requise, films uniquement)
 *
 * @module index
 */

require('dotenv').config();

const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const OpenSubtitlesClient = require('./lib/opensubtitles');
const { RateLimitError } = require('./lib/opensubtitles');
const SubDLClient = require('./lib/subdl');
const YIFYClient = require('./lib/yify');

// Configuration des variables d'environnement
const PORT = parseInt(process.env.PORT, 10) || 7000;
const ADDON_URL_CONFIGURED = !!process.env.ADDON_URL;
let addonUrl = process.env.ADDON_URL || `http://localhost:${PORT}`;
const OS_API_KEY = process.env.OPENSUBTITLES_API_KEY;
const OS_USER_AGENT = process.env.OPENSUBTITLES_USER_AGENT || 'stremio-subtitles-fr v1.0';
const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
const ENABLE_YIFY = process.env.ENABLE_YIFY !== 'false';

// Initialisation des clients
let osClient = null;
let subdlClient = null;
let yifyClient = null;

// Liste des sources actives
const sources = [];

if (OS_API_KEY && OS_API_KEY !== 'your_api_key_here') {
    osClient = new OpenSubtitlesClient(OS_API_KEY, OS_USER_AGENT);
    sources.push('OpenSubtitles');
    console.log('[Addon] Source activée: OpenSubtitles (avec proxy)');
}

if (SUBDL_API_KEY && SUBDL_API_KEY !== 'your_api_key_here') {
    subdlClient = new SubDLClient(SUBDL_API_KEY);
    sources.push('SubDL');
    console.log('[Addon] Source activée: SubDL');
}

if (ENABLE_YIFY) {
    yifyClient = new YIFYClient();
    sources.push('YIFY');
    console.log('[Addon] Source activée: YIFY (films uniquement)');
}

if (sources.length === 0) {
    console.error('[Addon] Erreur: Aucune source configurée!');
    console.error('[Addon] Configurez OPENSUBTITLES_API_KEY ou SUBDL_API_KEY dans .env');
    console.error('[Addon] Ou activez YIFY avec ENABLE_YIFY=true');
    process.exit(1);
}

/**
 * Manifest de l'addon Stremio
 */
const manifest = {
    id: 'community.subtitles.fr',
    version: '1.3.0',
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
 */
builder.defineSubtitlesHandler(async (args) => {
    const { type, id } = args;

    console.log(`\n[Addon] === Nouvelle requête sous-titres ===`);
    console.log(`[Addon] Type: ${type}, ID: ${id}`);

    try {
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

        if (yifyClient) {
            searchPromises.push(searchYIFY(parsed));
        }

        const results = await Promise.all(searchPromises);
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

        // Passe l'URL de l'addon pour générer les URLs de proxy
        return osClient.formatForStremio(subtitles, addonUrl);
    } catch (error) {
        console.error('[Addon] Erreur OpenSubtitles:', error.message);
        return [];
    }
}

/**
 * Recherche des sous-titres sur SubDL
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
 * Recherche des sous-titres sur YIFY
 */
async function searchYIFY(parsed) {
    try {
        const subtitles = await yifyClient.searchSubtitles({
            imdbId: parsed.imdbId,
            type: parsed.type
        });

        if (subtitles.length === 0) {
            return [];
        }

        return yifyClient.formatForStremio(subtitles);
    } catch (error) {
        console.error('[Addon] Erreur YIFY:', error.message);
        return [];
    }
}

/**
 * Parse l'identifiant Stremio pour extraire les informations
 */
function parseId(id, type) {
    const result = {
        imdbId: null,
        type: type,
        season: null,
        episode: null
    };

    if (!id) return result;

    if (type === 'series' && id.includes(':')) {
        const parts = id.split(':');
        result.imdbId = parts[0];
        result.season = parseInt(parts[1], 10) || null;
        result.episode = parseInt(parts[2], 10) || null;
    } else {
        result.imdbId = id.split(':')[0];
    }

    if (!result.imdbId || !result.imdbId.match(/^tt\d+$/)) {
        result.imdbId = null;
    }

    return result;
}

// ============================================
// Serveur Express avec routes personnalisées
// ============================================

const app = express();

// Middleware pour détecter l'URL automatiquement si non configurée
app.use((req, res, next) => {
    if (!ADDON_URL_CONFIGURED && req.headers.host) {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const detectedUrl = `${protocol}://${req.headers.host}`;
        if (addonUrl !== detectedUrl) {
            addonUrl = detectedUrl;
            console.log(`[Addon] URL détectée automatiquement: ${addonUrl}`);
        }
    }
    next();
});

// Route proxy pour OpenSubtitles (lazy download)
app.get('/proxy/os/:fileId', async (req, res) => {
    const { fileId } = req.params;

    // Validation du fileId (doit être numérique)
    if (!fileId || !/^\d+$/.test(fileId)) {
        console.error(`[Proxy] fileId invalide: ${fileId}`);
        return res.status(400).send('Invalid file ID');
    }

    console.log(`[Proxy] Demande de téléchargement pour file_id: ${fileId}`);

    if (!osClient) {
        console.error('[Proxy] OpenSubtitles non configuré');
        return res.status(503).send('OpenSubtitles not configured');
    }

    try {
        const downloadUrl = await osClient.getDownloadLink(parseInt(fileId, 10));

        if (!downloadUrl) {
            console.error(`[Proxy] Lien non trouvé pour file_id: ${fileId}`);
            return res.status(404).send('Subtitle not found');
        }

        console.log(`[Proxy] Redirection vers: ${downloadUrl}`);
        return res.redirect(downloadUrl);

    } catch (error) {
        if (error instanceof RateLimitError) {
            console.error(`[Proxy] Rate limit! Retry-After: ${error.retryAfter}s`);
            if (error.retryAfter) {
                res.set('Retry-After', error.retryAfter);
            }
            return res.status(429).send('Rate limit exceeded. Please try again later.');
        }

        console.error(`[Proxy] Erreur: ${error.message}`);
        return res.status(500).send('Internal server error');
    }
});

// Monte le router Stremio sur l'app Express
app.use(getRouter(builder.getInterface()));

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`\n[Addon] ========================================`);
    console.log(`[Addon] Subtitles FR Addon v1.3.0 démarré!`);
    console.log(`[Addon] Sources: ${sources.join(', ')}`);
    console.log(`[Addon] Port: ${PORT}`);

    if (ADDON_URL_CONFIGURED) {
        console.log(`[Addon] URL publique: ${addonUrl}`);
    } else {
        console.log(`[Addon] ⚠️  ADDON_URL non configurée (auto-détection activée)`);
        console.log(`[Addon] URL par défaut: ${addonUrl}`);
    }

    console.log(`[Addon] Manifest: ${addonUrl}/manifest.json`);
    console.log(`[Addon] ========================================\n`);
    console.log(`[Addon] Pour installer dans Stremio:`);
    console.log(`[Addon] 1. Ouvrez Stremio`);
    console.log(`[Addon] 2. Allez dans Addons > Community Addons`);
    console.log(`[Addon] 3. Collez: ${addonUrl}/manifest.json`);
    console.log(`[Addon] ========================================\n`);
    console.log(`[Addon] ⚡ Optimisations activées:`);
    console.log(`[Addon]   - Proxy pour OpenSubtitles (lazy download)`);
    console.log(`[Addon]   - Cache des liens (TTL 3h)`);
    console.log(`[Addon]   - Dédup in-flight (évite les appels simultanés)`);
    console.log(`[Addon]   - Max 5 résultats par source`);
    console.log(`[Addon] ========================================\n`);
});
