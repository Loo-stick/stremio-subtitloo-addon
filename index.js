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
const BADGE_IN_TITLE = process.env.BADGE_IN_TITLE === 'true';
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
    version: '1.5.2',
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
    const { type, id, extra } = args;

    console.log(`\n[Addon] === Nouvelle requête sous-titres ===`);
    console.log(`[Addon] Type: ${type}, ID: ${id}`);

    // Extraction des infos de fichier depuis extra (Stremio les fournit)
    const videoHash = extra?.videoHash || null;
    const videoSize = extra?.videoSize ? parseInt(extra.videoSize, 10) : null;
    const filename = extra?.filename || null;

    if (videoHash || filename) {
        console.log(`[Addon] Infos fichier: hash=${videoHash || 'N/A'}, size=${videoSize || 'N/A'}, file=${filename || 'N/A'}`);
    }

    try {
        const parsed = parseId(id, type, extra || {});

        if (!parsed.imdbId) {
            console.log('[Addon] ID IMDB invalide');
            return { subtitles: [] };
        }

        // Génère une clé de cache unique (sans les infos de fichier pour réutiliser le cache)
        const cacheKey = id;

        // Vérifie le cache d'abord
        const cachedSubtitles = subtitlesCache.get(type, cacheKey);
        if (cachedSubtitles !== null) {
            console.log(`[Addon] Cache HIT - ${cachedSubtitles.length} sous-titre(s)`);

            // Si on a des infos de fichier, on retrie les résultats cachés
            if (filename || videoHash) {
                const sortedSubtitles = sortSubtitlesByMatch(cachedSubtitles, parsed);
                return { subtitles: sortedSubtitles };
            }

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
        subtitlesCache.set(type, cacheKey, allSubtitles);

        if (allSubtitles.length === 0) {
            console.log('[Addon] Aucun sous-titre trouvé sur aucune source');
            return { subtitles: [] };
        }

        // Tri par score de correspondance si on a des infos de fichier
        const sortedSubtitles = sortSubtitlesByMatch(allSubtitles, parsed);

        console.log(`[Addon] Total: ${sortedSubtitles.length} sous-titre(s) combinés (mis en cache)`);
        return { subtitles: sortedSubtitles };

    } catch (error) {
        console.error('[Addon] Erreur handler sous-titres:', error.message);
        return { subtitles: [] };
    }
});

/**
 * Trie les sous-titres par score de correspondance avec le fichier vidéo
 *
 * @param {Array} subtitles - Liste des sous-titres
 * @param {Object} parsed - Infos parsées (incluant filename, videoHash)
 * @returns {Array} Sous-titres triés par score décroissant
 */
function sortSubtitlesByMatch(subtitles, parsed) {
    // Si pas d'infos de fichier, on garde l'ordre original
    if (!parsed.filename && !parsed.videoHash) {
        return subtitles;
    }

    const videoInfo = parseReleaseName(parsed.filename);

    // Calcule le score pour chaque sous-titre
    const scoredSubtitles = subtitles.map(sub => {
        const isHashMatch = sub._hashMatch === true;
        const score = calculateMatchScore(sub, videoInfo, isHashMatch);

        return {
            ...sub,
            _score: score
        };
    });

    // Trie par score décroissant
    scoredSubtitles.sort((a, b) => b._score - a._score);

    // Log les premiers résultats pour debug
    const topResults = scoredSubtitles.slice(0, 3);
    if (topResults.length > 0 && topResults[0]._score > 0) {
        console.log(`[Addon] Top 3 matchs:`);
        topResults.forEach((sub, i) => {
            console.log(`  ${i + 1}. Score ${sub._score}: ${sub._release || sub.SubFileName}`);
        });
    }

    // Nettoie les propriétés internes avant de retourner
    return scoredSubtitles.map(sub => {
        const cleaned = { ...sub };
        delete cleaned._score;
        delete cleaned._release;
        delete cleaned._hashMatch;
        return cleaned;
    });
}

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

            // Ajoute un badge emoji si activé
            if (BADGE_IN_TITLE) {
                // Ajoute le badge dans releaseInfo (ligne année/durée)
                meta.releaseInfo = enrichReleaseInfo(meta.releaseInfo || meta.year, subtitleInfo);
            }

            console.log(`[Addon] Meta enrichie: "${meta.name}"${BADGE_IN_TITLE && subtitleInfo?.available ? ' 🇫🇷' : ''}`);
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
 * Enrichit le titre avec un badge emoji indiquant la disponibilité
 *
 * @param {string} originalTitle - Titre original
 * @param {Object|null} subtitleInfo - Info sous-titres { available, count, sources } ou null
 * @returns {string} Titre avec badge
 */
function enrichTitle(originalTitle, subtitleInfo) {
    if (!originalTitle) return originalTitle;

    // Badge selon la disponibilité
    let badge = '';

    if (subtitleInfo === null) {
        badge = ' ⏳'; // En attente d'info
    } else if (subtitleInfo.available) {
        badge = ' 🇫🇷'; // Sous-titres FR disponibles
    }
    // Pas de badge si aucun sous-titre (pour ne pas polluer)

    return originalTitle + badge;
}

/**
 * Enrichit releaseInfo avec le badge de sous-titres
 *
 * @param {string} originalReleaseInfo - ReleaseInfo original (ex: "1994-2004")
 * @param {Object|null} subtitleInfo - Info sous-titres
 * @returns {string} ReleaseInfo avec badge
 */
function enrichReleaseInfo(originalReleaseInfo, subtitleInfo) {
    const base = originalReleaseInfo || '';

    if (subtitleInfo === null) {
        return base; // Pas d'info, on ne change rien
    } else if (subtitleInfo.available) {
        return base ? `${base} 🇫🇷` : '🇫🇷 Subs FR';
    }

    return base;
}

/**
 * Recherche des sous-titres sur OpenSubtitles
 */
async function searchOpenSubtitles(parsed) {
    try {
        const searchResult = await osClient.searchSubtitles({
            imdbId: parsed.imdbId,
            type: parsed.type,
            season: parsed.season,
            episode: parsed.episode,
            videoHash: parsed.videoHash,
            videoSize: parsed.videoSize
        });

        if (searchResult.subtitles.length === 0) {
            return [];
        }

        // Passe l'URL de l'addon pour générer les URLs de proxy
        return osClient.formatForStremio(searchResult, addonUrl);
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
 *
 * @param {string} id - ID Stremio (ex: tt1234567 ou tt1234567:1:2)
 * @param {string} type - Type de contenu (movie ou series)
 * @param {Object} extra - Paramètres extra de Stremio
 * @returns {Object} Infos parsées
 */
function parseId(id, type, extra = {}) {
    const result = {
        imdbId: null,
        type: type,
        season: null,
        episode: null,
        // Infos fichier pour matching
        videoHash: extra.videoHash || null,
        videoSize: extra.videoSize ? parseInt(extra.videoSize, 10) : null,
        filename: extra.filename || null
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

/**
 * Parse le nom d'un fichier pour extraire les infos de release
 *
 * @param {string} filename - Nom du fichier vidéo
 * @returns {Object} Infos extraites (group, quality, source, codec, etc.)
 */
function parseReleaseName(filename) {
    if (!filename) return {};

    const result = {
        original: filename,
        normalized: filename.toLowerCase().replace(/[._-]/g, ' '),
        group: null,
        quality: null,
        source: null,
        codec: null,
        year: null
    };

    // Extrait le groupe de release (généralement à la fin après un tiret)
    const groupMatch = filename.match(/-([A-Za-z0-9]+)(?:\.[a-z]{2,4})?$/i);
    if (groupMatch) {
        result.group = groupMatch[1].toUpperCase();
    }

    // Qualité vidéo
    const qualityPatterns = [
        { pattern: /2160p|4k|uhd/i, value: '2160p' },
        { pattern: /1080p/i, value: '1080p' },
        { pattern: /720p/i, value: '720p' },
        { pattern: /480p/i, value: '480p' },
        { pattern: /hdtv/i, value: 'HDTV' }
    ];
    for (const { pattern, value } of qualityPatterns) {
        if (pattern.test(filename)) {
            result.quality = value;
            break;
        }
    }

    // Source
    const sourcePatterns = [
        { pattern: /bluray|blu-ray|bdrip|brrip/i, value: 'BluRay' },
        { pattern: /webrip|web-rip/i, value: 'WEBRip' },
        { pattern: /web-dl|webdl/i, value: 'WEB-DL' },
        { pattern: /hdtv/i, value: 'HDTV' },
        { pattern: /dvdrip/i, value: 'DVDRip' }
    ];
    for (const { pattern, value } of sourcePatterns) {
        if (pattern.test(filename)) {
            result.source = value;
            break;
        }
    }

    // Codec
    const codecPatterns = [
        { pattern: /x265|h\.?265|hevc/i, value: 'x265' },
        { pattern: /x264|h\.?264|avc/i, value: 'x264' }
    ];
    for (const { pattern, value } of codecPatterns) {
        if (pattern.test(filename)) {
            result.codec = value;
            break;
        }
    }

    // Année
    const yearMatch = filename.match(/[.\s([]?(19|20)\d{2}[.\s)\]]/);
    if (yearMatch) {
        result.year = yearMatch[0].replace(/[.\s()[\]]/g, '');
    }

    return result;
}

/**
 * Calcule un score de correspondance entre un sous-titre et un fichier vidéo
 *
 * @param {Object} subtitle - Sous-titre avec ses infos
 * @param {Object} videoInfo - Infos du fichier vidéo parsées
 * @param {boolean} hashMatch - True si le hash correspond
 * @returns {number} Score (0-100)
 */
function calculateMatchScore(subtitle, videoInfo, hashMatch = false) {
    // Hash match = score parfait
    if (hashMatch) return 100;

    let score = 0;
    const subRelease = subtitle.release || subtitle.SubFileName || '';
    const subInfo = parseReleaseName(subRelease);

    // Match du groupe de release (+40 points)
    if (videoInfo.group && subInfo.group && videoInfo.group === subInfo.group) {
        score += 40;
    }

    // Match de la qualité (+20 points)
    if (videoInfo.quality && subInfo.quality && videoInfo.quality === subInfo.quality) {
        score += 20;
    }

    // Match de la source (+15 points)
    if (videoInfo.source && subInfo.source && videoInfo.source === subInfo.source) {
        score += 15;
    }

    // Match du codec (+10 points)
    if (videoInfo.codec && subInfo.codec && videoInfo.codec === subInfo.codec) {
        score += 10;
    }

    // Bonus si le nom normalisé contient des mots communs (+5 points max)
    if (videoInfo.normalized && subInfo.normalized) {
        const videoWords = new Set(videoInfo.normalized.split(/\s+/).filter(w => w.length > 2));
        const subWords = new Set(subInfo.normalized.split(/\s+/).filter(w => w.length > 2));
        let commonWords = 0;
        for (const word of videoWords) {
            if (subWords.has(word)) commonWords++;
        }
        score += Math.min(commonWords, 5);
    }

    return score;
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
    console.log(`[Addon]   - File matching (hash + release name scoring)`);

    if (metaCache) {
        console.log(`[Addon]   - Info dispo sous-titres sur fiche (cache ${CACHE_TTL_DAYS}j)`);
        if (BADGE_IN_TITLE) {
            console.log(`[Addon]   - Badge 🇫🇷 dans les métadonnées si sous-titres dispo`);
        }
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
