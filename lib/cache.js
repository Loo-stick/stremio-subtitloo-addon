/**
 * Cache persistant pour les informations de disponibilité des sous-titres
 *
 * Stocke les résultats dans un fichier JSON pour éviter les appels API répétés.
 * Le cache survit aux redémarrages de l'addon.
 *
 * @module lib/cache
 */

const fs = require('fs');
const path = require('path');

/** Durée de vie par défaut du cache (7 jours en ms) */
const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000;

/** Intervalle de sauvegarde automatique (5 minutes en ms) */
const SAVE_INTERVAL = 5 * 60 * 1000;

/**
 * Classe de cache persistant avec stockage JSON
 */
class PersistentCache {
    /**
     * Crée une instance du cache persistant
     *
     * @param {Object} options - Options de configuration
     * @param {string} [options.cacheDir] - Répertoire de stockage du cache
     * @param {number} [options.ttl] - Durée de vie des entrées en ms
     */
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'data');
        this.cachePath = path.join(this.cacheDir, 'cache.json');
        this.ttl = options.ttl || DEFAULT_TTL;
        this.data = {};
        this.dirty = false;

        // Charge le cache existant
        this.load();

        // Sauvegarde périodique
        this.saveInterval = setInterval(() => this.save(), SAVE_INTERVAL);

        // Sauvegarde à l'arrêt
        process.on('SIGTERM', () => this.save());
        process.on('SIGINT', () => this.save());
    }

    /**
     * Charge le cache depuis le fichier JSON
     */
    load() {
        try {
            // Crée le répertoire si nécessaire
            if (!fs.existsSync(this.cacheDir)) {
                fs.mkdirSync(this.cacheDir, { recursive: true });
                console.log(`[Cache] Répertoire créé: ${this.cacheDir}`);
            }

            // Charge le fichier s'il existe
            if (fs.existsSync(this.cachePath)) {
                const content = fs.readFileSync(this.cachePath, 'utf-8');
                this.data = JSON.parse(content);
                const count = Object.keys(this.data).length;
                console.log(`[Cache] Chargé: ${count} entrée(s)`);
            } else {
                console.log('[Cache] Aucun cache existant, démarrage à vide');
            }
        } catch (error) {
            console.error('[Cache] Erreur de chargement:', error.message);
            this.data = {};
        }
    }

    /**
     * Sauvegarde le cache dans le fichier JSON
     *
     * @returns {boolean} Succès de la sauvegarde
     */
    save() {
        if (!this.dirty) {
            return true;
        }

        try {
            // Nettoie les entrées expirées avant de sauvegarder
            this.cleanup();

            const content = JSON.stringify(this.data, null, 2);
            fs.writeFileSync(this.cachePath, content, 'utf-8');
            this.dirty = false;

            const count = Object.keys(this.data).length;
            console.log(`[Cache] Sauvegardé: ${count} entrée(s)`);
            return true;
        } catch (error) {
            console.error('[Cache] Erreur de sauvegarde:', error.message);
            return false;
        }
    }

    /**
     * Récupère une entrée du cache
     *
     * @param {string} imdbId - ID IMDB (ex: tt1234567)
     * @returns {Object|null} Données cachées ou null si expirées/inexistantes
     */
    get(imdbId) {
        const entry = this.data[imdbId];

        if (!entry) {
            return null;
        }

        // Vérifie si l'entrée est expirée
        if (Date.now() > entry.expiresAt) {
            delete this.data[imdbId];
            this.dirty = true;
            return null;
        }

        return {
            available: entry.available,
            count: entry.count
        };
    }

    /**
     * Stocke une entrée dans le cache
     *
     * @param {string} imdbId - ID IMDB (ex: tt1234567)
     * @param {Object} data - Données à stocker
     * @param {boolean} data.available - Sous-titres disponibles
     * @param {number} data.count - Nombre de sous-titres trouvés
     */
    set(imdbId, data) {
        this.data[imdbId] = {
            available: data.available,
            count: data.count,
            checkedAt: Date.now(),
            expiresAt: Date.now() + this.ttl
        };
        this.dirty = true;
    }

    /**
     * Vérifie si une entrée existe et est valide
     *
     * @param {string} imdbId - ID IMDB
     * @returns {boolean} true si l'entrée existe et n'est pas expirée
     */
    has(imdbId) {
        return this.get(imdbId) !== null;
    }

    /**
     * Supprime les entrées expirées
     */
    cleanup() {
        const now = Date.now();
        let removed = 0;

        for (const [key, entry] of Object.entries(this.data)) {
            if (now > entry.expiresAt) {
                delete this.data[key];
                removed++;
            }
        }

        if (removed > 0) {
            this.dirty = true;
            console.log(`[Cache] Nettoyage: ${removed} entrée(s) expirée(s) supprimée(s)`);
        }
    }

    /**
     * Retourne les statistiques du cache
     *
     * @returns {Object} Statistiques
     */
    stats() {
        const entries = Object.values(this.data);
        const now = Date.now();

        return {
            total: entries.length,
            valid: entries.filter(e => now <= e.expiresAt).length,
            expired: entries.filter(e => now > e.expiresAt).length,
            withSubtitles: entries.filter(e => e.available).length,
            withoutSubtitles: entries.filter(e => !e.available).length
        };
    }

    /**
     * Vide entièrement le cache
     */
    clear() {
        this.data = {};
        this.dirty = true;
        this.save();
        console.log('[Cache] Cache entièrement vidé');
    }

    /**
     * Invalide une entrée spécifique
     *
     * @param {string} imdbId - ID IMDB à invalider
     * @returns {boolean} true si l'entrée existait et a été supprimée
     */
    invalidate(imdbId) {
        if (this.data[imdbId]) {
            delete this.data[imdbId];
            this.dirty = true;
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Arrête le cache proprement
     */
    stop() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }
        this.save();
    }
}

module.exports = PersistentCache;
