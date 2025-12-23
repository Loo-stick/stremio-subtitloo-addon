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
const CinemetaClient = require('./lib/cinemeta');
const SubtitleChecker = require('./lib/subtitle-checker');
const PersistentCache = require('./lib/cache');

// Configuration des variables d'environnement
const PORT = parseInt(process.env.PORT, 10) || 7000;
const ADDON_URL_CONFIGURED = !!process.env.ADDON_URL;
let addonUrl = process.env.ADDON_URL || `http://localhost:${PORT}`;
const OS_API_KEY = process.env.OPENSUBTITLES_API_KEY;
const OS_USER_AGENT = process.env.OPENSUBTITLES_USER_AGENT || 'stremio-subtitles-fr v1.0';
const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
const ENABLE_YIFY = process.env.ENABLE_YIFY !== 'false';
const ENABLE_META = process.env.ENABLE_META !== 'false';
const CACHE_TTL_DAYS = parseInt(process.env.CACHE_TTL_DAYS, 10) || 7;
const SUBTITLES_CACHE_TTL_HOURS = parseInt(process.env.SUBTITLES_CACHE_TTL_HOURS, 10) || 24;

/**
 * Cache en mémoire pour les recherches de sous-titres
 * Évite de refaire les mêmes appels API pour un même contenu
 */
class SubtitlesCache {
    constructor(ttlMs) {
        this.cache = new Map();
        this.ttl = ttlMs;
        this.hits = 0;
        this.misses = 0;

        // Nettoyage périodique toutes les 30 minutes
        setInterval(() => this.cleanup(), 30 * 60 * 1000);
    }

    /**
     * Génère une clé de cache unique pour une requête
     */
    generateKey(type, id) {
        return `${type}:${id}`;
    }

    /**
     * Récupère les sous-titres du cache
     */
    get(type, id) {
        const key = this.generateKey(type, id);
        const item = this.cache.get(key);

        if (!item) {
            this.misses++;
            return null;
        }

        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            this.misses++;
            return null;
        }

        this.hits++;
        return item.subtitles;
    }

    /**
     * Stocke les sous-titres dans le cache
     */
    set(type, id, subtitles) {
        const key = this.generateKey(type, id);
        this.cache.set(key, {
            subtitles,
            expiry: Date.now() + this.ttl,
            timestamp: Date.now()
        });
    }

    /**
     * Nettoie les entrées expirées
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiry) {
                this.cache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`[SubtitlesCache] Nettoyage: ${cleaned} entrée(s) expirée(s) supprimée(s)`);
        }
    }

    /**
     * Vide le cache
     */
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Retourne les statistiques du cache
     */
    stats() {
        return {
            entries: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: this.hits + this.misses > 0
                ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + '%'
                : 'N/A',
            ttlHours: this.ttl / (60 * 60 * 1000)
        };
    }
}

// Cache des recherches de sous-titres (TTL configurable, défaut 24h)
const subtitlesCache = new SubtitlesCache(SUBTITLES_CACHE_TTL_HOURS * 60 * 60 * 1000);
console.log(`[Addon] Cache sous-titres activé (TTL: ${SUBTITLES_CACHE_TTL_HOURS}h)`);

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

// Initialisation des clients pour la fonctionnalité meta
let cinemetaClient = null;
let subtitleChecker = null;
let metaCache = null;

// La fonctionnalité meta nécessite au moins une source configurée
const hasMetaSource = OS_API_KEY || SUBDL_API_KEY || ENABLE_YIFY;

if (ENABLE_META && hasMetaSource) {
    cinemetaClient = new CinemetaClient();
    subtitleChecker = new SubtitleChecker({
        osApiKey: OS_API_KEY,
        osUserAgent: OS_USER_AGENT,
        subdlApiKey: SUBDL_API_KEY,
        enableYify: ENABLE_YIFY
    });
    metaCache = new PersistentCache({
        ttl: CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
    });
    console.log('[Addon] Fonctionnalité META activée (affichage dispo sous-titres)');
} else if (ENABLE_META && !hasMetaSource) {
    console.log('[Addon] Fonctionnalité META désactivée (aucune source configurée)');
}

/**
 * Manifest de l'addon Stremio
 */
const resources = ['subtitles'];
if (ENABLE_META && hasMetaSource) {
    resources.unshift('meta'); // meta en premier pour priorité
}

const manifest = {
    id: 'community.subtitles.fr',
    version: '1.4.1',
    name: 'Subtitles FR',
    description: `Sous-titres français (${sources.join(' + ')})${ENABLE_META && hasMetaSource ? ' + Info dispo' : ''}`,
    logo: 'https://www.opensubtitles.org/favicon.ico',
    catalogs: [],
    resources: resources,
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

        // Vérifie le cache d'abord
        const cachedSubtitles = subtitlesCache.get(type, id);
        if (cachedSubtitles !== null) {
            console.log(`[Addon] Cache HIT - ${cachedSubtitles.length} sous-titre(s)`);
            return { subtitles: cachedSubtitles };
        }

        console.log(`[Addon] Cache MISS - Recherche sur les APIs...`);
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

        // Stocke dans le cache (même si vide, pour éviter de refaire la recherche)
        subtitlesCache.set(type, id, allSubtitles);

        if (allSubtitles.length === 0) {
            console.log('[Addon] Aucun sous-titre trouvé sur aucune source');
            return { subtitles: [] };
        }

        console.log(`[Addon] Total: ${allSubtitles.length} sous-titre(s) combinés (mis en cache)`);
        return { subtitles: allSubtitles };

    } catch (error) {
        console.error('[Addon] Erreur handler sous-titres:', error.message);
        return { subtitles: [] };
    }
});

/**
 * Handler pour les requêtes de métadonnées (affichage dispo sous-titres)
 */
if (ENABLE_META && cinemetaClient && subtitleChecker) {
    builder.defineMetaHandler(async (args) => {
        const { type, id } = args;

        console.log(`\n[Addon] === Nouvelle requête meta ===`);
        console.log(`[Addon] Type: ${type}, ID: ${id}`);

        // Extrait l'ID IMDB
        const imdbId = id.split(':')[0];

        if (!imdbId || !imdbId.match(/^tt\d+$/)) {
            console.log('[Addon] ID IMDB invalide');
            return { meta: null };
        }

        try {
            // Vérifie le cache d'abord
            let subtitleInfo = metaCache.get(imdbId);
            let needsCheck = subtitleInfo === null;

            // Appels en parallèle
            const promises = [
                cinemetaClient.getMeta(type, imdbId)
            ];

            if (needsCheck) {
                promises.push(subtitleChecker.checkAll(imdbId, type));
            }

            const results = await Promise.all(promises);

            const meta = results[0];
            if (needsCheck) {
                subtitleInfo = results[1];

                if (subtitleInfo !== null) {
                    metaCache.set(imdbId, subtitleInfo);
                }
            }

            if (!meta) {
                console.log('[Addon] Pas de métadonnées Cinemeta');
                return { meta: null };
            }

            // Enrichit la description
            meta.description = enrichDescription(meta.description, subtitleInfo);

            console.log(`[Addon] Meta enrichie: "${meta.name}"`);
            return { meta };

        } catch (error) {
            console.error('[Addon] Erreur handler meta:', error.message);
            return { meta: null };
        }
    });
}

/**
 * Enrichit la description avec l'information de disponibilité des sous-titres
 *
 * @param {string} originalDesc - Description originale
 * @param {Object|null} subtitleInfo - Info sous-titres { available, count, sources } ou null
 * @returns {string} Description enrichie
 */
function enrichDescription(originalDesc, subtitleInfo) {
    let prefix = '';

    if (subtitleInfo === null) {
        prefix = 'Sous-titres FR : info non disponible\n\n';
    } else if (subtitleInfo.available) {
        // Détails par source
        const details = [];
        if (subtitleInfo.sources) {
            if (subtitleInfo.sources.os?.count) details.push(`OS:${subtitleInfo.sources.os.count}`);
            if (subtitleInfo.sources.subdl?.count) details.push(`SubDL:${subtitleInfo.sources.subdl.count}`);
            if (subtitleInfo.sources.yify?.count) details.push(`YIFY:${subtitleInfo.sources.yify.count}`);
        }
        const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
        prefix = `Sous-titres FR disponibles${detailStr}\n\n`;
    } else {
        prefix = 'Pas de sous-titres FR disponibles\n\n';
    }

    return prefix + (originalDesc || '');
}

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

// Route de santé
app.get('/health', (req, res) => {
    const response = {
        status: 'ok',
        version: manifest.version,
        sources: sources,
        metaEnabled: !!metaCache,
        subtitlesCache: subtitlesCache.stats()
    };

    if (metaCache) {
        response.metaCache = metaCache.stats();
    }

    res.json(response);
});

// Routes de gestion du cache des sous-titres
app.get('/subtitles-cache/stats', (req, res) => {
    res.json(subtitlesCache.stats());
});

app.get('/subtitles-cache/clear', (req, res) => {
    subtitlesCache.clear();
    console.log('[Addon] Cache sous-titres vidé via /subtitles-cache/clear');
    res.json({ success: true, message: 'Cache sous-titres vidé' });
});

// Routes de gestion du cache (si meta activé)
if (metaCache) {
    app.get('/cache/clear', (req, res) => {
        metaCache.clear();
        console.log('[Addon] Cache vidé via /cache/clear');
        res.json({ success: true, message: 'Cache vidé' });
    });

    app.get('/cache/invalidate/:imdbId', (req, res) => {
        const { imdbId } = req.params;
        const deleted = metaCache.invalidate(imdbId);
        console.log(`[Addon] Cache invalidé pour ${imdbId}: ${deleted ? 'supprimé' : 'non trouvé'}`);
        res.json({ success: deleted, imdbId, message: deleted ? 'Entrée supprimée' : 'Entrée non trouvée' });
    });

    app.get('/stats', (req, res) => {
        res.json(metaCache.stats());
    });
}

// Monte le router Stremio sur l'app Express
app.use(getRouter(builder.getInterface()));

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`\n[Addon] ========================================`);
    console.log(`[Addon] Subtitles FR Addon v${manifest.version} démarré!`);
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
    console.log(`[Addon]   - Cache des liens OpenSubtitles (TTL 3h)`);
    console.log(`[Addon]   - Cache des recherches sous-titres (TTL ${SUBTITLES_CACHE_TTL_HOURS}h)`);
    console.log(`[Addon]   - Dédup in-flight (évite les appels simultanés)`);
    console.log(`[Addon]   - Max 5 résultats par source`);

    if (metaCache) {
        console.log(`[Addon]   - Info dispo sous-titres sur fiche (cache ${CACHE_TTL_DAYS}j)`);
        console.log(`[Addon] Cache meta: ${metaCache.stats().total} entrée(s)`);
    }

    console.log(`[Addon] ========================================\n`);
});

// Gestion de l'arrêt propre
process.on('SIGTERM', () => {
    console.log('[Addon] Arrêt demandé...');
    if (metaCache) {
        metaCache.stop();
    }
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n[Addon] Interruption...');
    if (metaCache) {
        metaCache.stop();
    }
    process.exit(0);
});
