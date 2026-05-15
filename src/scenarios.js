// scenarios.js — section-1 (Data and Scenarios)
//
// Read-only API over the static scenario library plus shared type-shape JSDoc
// definitions that other sections consume.

/**
 * @typedef {string} ScenarioId
 *
 * @typedef {Object} Scenario
 * @property {ScenarioId} scenario_id
 * @property {string} description
 * @property {string|null} board
 * @property {string[]} action_history
 * @property {string[]} available_actions
 * @property {string} gto_action
 * @property {string} gto_explanation
 * @property {string} lesson_tag
 *
 * @typedef {Object} PlayerSubmission
 * @property {ScenarioId} scenario_id
 * @property {string} action
 * @property {number} confidence  1..5
 * @property {string|null} note
 * @property {string} submitted_at  ISO-8601
 *
 * @typedef {Object} GameConfig
 * @property {number} rounds        1..10
 * @property {number} handful_size  1..10
 * @property {string} scenario_seed
 *
 * @typedef {Object} Participant
 * @property {string} uid
 * @property {string} displayName
 * @property {string} joinedAt
 * @property {Object|null} [pushSubscription]
 *
 * @typedef {Object} Round
 * @property {number} roundIndex
 * @property {string} leaderUid
 * @property {ScenarioId[]} scenarioIds
 * @property {Object<string, PlayerSubmission[]>} submissionsByUid
 *
 * @typedef {Object} GameDocument
 * @property {string} gameId
 * @property {string} createdAt
 * @property {GameConfig} config
 * @property {Participant[]} participants
 * @property {Round[]} rounds
 * @property {('waiting_for_opponent'|'in_progress'|'complete')} status
 *
 * @typedef {Object} PushSubscriptionRecord
 * @property {string} endpoint
 * @property {{p256dh:string, auth:string}} keys
 * @property {string} subscribed_at
 */

let _scenarios = null;
let _loadPromise = null;

/**
 * Load the library asynchronously. Idempotent.
 * @returns {Promise<Scenario[]>}
 */
export function loadScenarios() {
  if (_scenarios) return Promise.resolve(_scenarios);
  if (_loadPromise) return _loadPromise;
  // scenarios.json lives at ../data/scenarios.json relative to this module
  // (which lives in src/). The URL constructor with import.meta.url makes
  // this work under any GitHub Pages subpath.
  const url = new URL("../data/scenarios.json", import.meta.url);
  _loadPromise = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error("scenarios.json fetch failed: " + r.status);
      return r.json();
    })
    .then((arr) => {
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error("scenarios.json is empty or malformed");
      }
      _scenarios = Object.freeze(arr.map(Object.freeze));
      return _scenarios;
    });
  return _loadPromise;
}

export function listScenarios() {
  if (!_scenarios) {
    throw new Error("listScenarios() called before loadScenarios() resolved");
  }
  return _scenarios;
}

/**
 * @param {ScenarioId} scenario_id
 * @returns {Scenario|null}
 */
export function getScenarioById(scenario_id) {
  if (!_scenarios) {
    throw new Error("getScenarioById() called before loadScenarios() resolved");
  }
  return _scenarios.find((s) => s.scenario_id === scenario_id) || null;
}

// -----------------------------------------------------------------------
// Deterministic seeded RNG (mulberry32) + sampling without replacement.
// -----------------------------------------------------------------------

function hashStringToUint32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} n
 * @param {string} rngSeed
 * @returns {Scenario[]}
 */
export function sampleNScenarios(n, rngSeed) {
  if (!_scenarios) {
    throw new Error("sampleNScenarios() called before loadScenarios() resolved");
  }
  if (!Number.isInteger(n) || n <= 0) return [];
  const rng = mulberry32(hashStringToUint32(String(rngSeed)));
  const pool = _scenarios.slice();
  const out = [];
  const k = Math.min(n, pool.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    out.push(pool[i]);
  }
  return out;
}

/**
 * @param {number} n
 * @param {string} rngSeed
 * @returns {ScenarioId[]}
 */
export function sampleNScenarioIds(n, rngSeed) {
  return sampleNScenarios(n, rngSeed).map((s) => s.scenario_id);
}
