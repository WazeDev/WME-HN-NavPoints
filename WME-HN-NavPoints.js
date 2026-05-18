// ==UserScript==
// @name            WME HN NavPoints (beta)
// @namespace       https://greasyfork.org/users/166843
// @description     Shows navigation points of all house numbers in WME
// @version         2026.05.18.00
// @author          dBsooner
// @grant           GM_info
// @grant           GM_xmlhttpRequest
// @connect         greasyfork.org
// @require         https://update.greasyfork.org/scripts/509664/WME%20Utils%20-%20Bootstrap.js
// @require         https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @license         GPLv3
// @match         *://*.waze.com/*editor*
// @exclude       *://*.waze.com/user/editor*
// @exclude       *://*.waze.com/editor/sdk/*
// @contributionURL https://github.com/WazeDev/Thank-The-Authors
// ==/UserScript==

/*
 * Original concept and code for WME HN NavPoints was written by MajkiiTelini. After version 0.6.6, this
 * script is maintained by the WazeDev team. Special thanks is definitely given to MajkiiTelini for his
 * hard work and dedication to the original script.
 *
 * SDK Migration (2026): Migrated from legacy W object and OpenLayers to WME SDK by JS55CT
 */

/* global bootstrap, turf, WazeWrap, GM_info, unsafeWindow */

(async function () {
  'use strict';

  // **************************************************************************************************************
  // IMPORTANT: Update this when releasing a new version of script
  // **************************************************************************************************************
  const SHOW_UPDATE_MESSAGE = true;
  const SCRIPT_VERSION_CHANGES = [
    'WME SDK migration from legacy W object',
    'Marker styling UI: size, font, opacity controls',
  ];

  // =====================================================================
  // CONSTANTS & METADATA
  // =====================================================================

  const _SCRIPT_LONG_NAME = GM_info.script.name;
  const _IS_ALPHA_VERSION = /\(DEV\)/i.test(_SCRIPT_LONG_NAME);
  const _IS_BETA_VERSION = /beta/i.test(_SCRIPT_LONG_NAME);
  const _DEBUG = _IS_ALPHA_VERSION || _IS_BETA_VERSION || /dev/i.test(_SCRIPT_LONG_NAME);
  const _SCRIPT_SHORT_NAME = `HN NavPoints${_IS_ALPHA_VERSION ? ' Ω' : _IS_BETA_VERSION ? ' β' : ''}`;
  const SCRIPT_VERSION = GM_info.script.version.toString();
  const _PROD_DL_URL = 'https://greasyfork.org/scripts/390565-wme-hn-navpoints/code/WME%20HN%20NavPoints.user.js';
  const _BETA_DL_URL = 'YUhSMGNITTZMeTluY21WaGMzbG1iM0pyTG05eVp5OXpZM0pwY0hSekx6TTVNRFUzTXkxM2JXVXRhRzR0Ym1GMmNHOXBiblJ6TFdKbGRHRXZZMjlrWlM5WFRVVWxNakJJVGlVeU1FNWhkbEJ2YVc1MGN5VXlNQ2hpWlhSaEtTNTFjMlZ5TG1weg==';

  const dec = (s = '') => atob(atob(s));

  const DOWNLOAD_URL = _IS_BETA_VERSION ? dec(_BETA_DL_URL) : _PROD_DL_URL;
  const FORUM_URL = 'https://www.waze.com/discuss/t/script-wme-hn-navpoints/182066/210';
  const SETTINGS_STORE_NAME = 'WMEHNNavPoints';
  const _LOAD_BEGIN_TIME = performance.now();

  // Layer names
  const LAYER_HN_LINES = 'HNNavPointsLinesLayer';
  const LAYER_HN_MARKERS = 'HNNavPointsMarkersLayer';

  // =====================================================================
  // LOGGING UTILITIES
  // =====================================================================

  /** Log a message to the console with script prefix. */
  function log(msg, data = '') {
    console.log(`${_SCRIPT_SHORT_NAME}:`, msg, data);
  }

  /** Log an error message to the console with script prefix. */
  function logError(msg, err = '') {
    console.error(`${_SCRIPT_SHORT_NAME}:`, new Error(msg), err);
  }

  /** Log a debug message (only if _DEBUG is true). */
  function logDebug(msg, data = '') {
    if (_DEBUG) log(msg, data);
  }

  // =====================================================================
  // UTILITY FUNCTIONS
  // =====================================================================

  // =====================================================================
  // SHORTCUT HELPER FUNCTIONS (from WMEPIE, verified 2026-03-11)
  // =====================================================================
  /* prettier-ignore */
  const _KEYCODE_TO_CHAR = { 65: 'A', 66: 'B', 67: 'C', 68: 'D', 69: 'E', 70: 'F', 71: 'G', 72: 'H', 73: 'I', 74: 'J', 75: 'K', 76: 'L', 77: 'M', 
    78: 'N', 79: 'O', 80: 'P', 81: 'Q', 82: 'R', 83: 'S', 84: 'T', 85: 'U', 86: 'V', 87: 'W', 88: 'X', 89: 'Y', 90: 'Z', 48: '0', 49: '1', 
    50: '2', 51: '3', 52: '4', 53: '5', 54: '6', 55: '7', 56: '8', 57: '9', 112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 
    118: 'F7', 119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12', 32: 'Space', 13: 'Enter', 9: 'Tab', 27: 'Esc', 8: 'Backspace', 
    46: 'Delete', 36: 'Home', 35: 'End', 33: 'PageUp', 34: 'PageDown', 45: 'Insert', 37: '←', 38: '↑', 39: '→', 40: '↓', 188: ',', 190: '.', 
    191: '/', 186: ';', 222: "'", 219: '[', 221: ']', 220: '\\', 189: '-', 187: '=', 192: '`' };

  const _CHAR_TO_KEYCODE = Object.fromEntries(Object.entries(_KEYCODE_TO_CHAR).map(([k, v]) => [v.toUpperCase(), Number(k)]));
  const _MOD_CHAR_TO_VAL = { C: 1, S: 2, A: 4 };

  /** Convert shortcut combo format (e.g., 'S+N') to raw keycode format (e.g., '2,78'). */
  function _comboToRaw(str) {
    if (!str || str === '' || str === '-1' || str === 'None') return null;
    if (/^\d+,-?\d+$/.test(str)) {
      const kc = parseInt(str.split(',')[1], 10);
      return kc < 0 ? null : str;
    }
    const s = String(str).toUpperCase();
    if (/^[A-Z0-9]$/.test(s)) return `0,${s.charCodeAt(0)}`;
    if (_CHAR_TO_KEYCODE[s] !== undefined) return `0,${_CHAR_TO_KEYCODE[s]}`;
    const mLetter = s.match(/^([ACS]+)\+([A-Z0-9])$/);
    if (mLetter) {
      const mod = mLetter[1].split('').reduce((a, c) => a | (_MOD_CHAR_TO_VAL[c] || 0), 0);
      return `${mod},${mLetter[2].charCodeAt(0)}`;
    }
    const mNumeric = s.match(/^([ACS]+)\+(\d+)$/);
    if (mNumeric) {
      const mod = mNumeric[1].split('').reduce((a, c) => a | (_MOD_CHAR_TO_VAL[c] || 0), 0);
      return `${mod},${mNumeric[2]}`;
    }
    const mSpecial = s.match(/^([ACS]+)\+(.+)$/);
    if (mSpecial && _CHAR_TO_KEYCODE[mSpecial[2]] !== undefined) {
      const mod = mSpecial[1].split('').reduce((a, c) => a | (_MOD_CHAR_TO_VAL[c] || 0), 0);
      return `${mod},${_CHAR_TO_KEYCODE[mSpecial[2]]}`;
    }
    return null;
  }

  /** Convert shortcut raw keycode format (e.g., '2,78') to combo format (e.g., 'S+N'). */
  function _rawToCombo(str) {
    const raw = _comboToRaw(str);
    if (!raw) return null;
    const [modStr, keyStr] = raw.split(',');
    const mod = parseInt(modStr, 10);
    const keyCode = parseInt(keyStr, 10);
    const keyChar = _KEYCODE_TO_CHAR[keyCode] || String(keyCode);
    let mods = '';
    if (mod & 1) mods += 'C';
    if (mod & 2) mods += 'S';
    if (mod & 4) mods += 'A';
    return mods ? `${mods}+${keyChar}` : keyChar;
  }

  /** Normalize a shortcut value to {raw, combo} object format. */
  function _normalizeShortcut(val) {
    const src = val && typeof val === 'object' ? (val.raw ?? val.combo) : val;
    const raw = _comboToRaw(src);
    const combo = _rawToCombo(raw);
    return { raw, combo };
  }

  // =====================================================================
  // GLOBAL STATE
  // =====================================================================

  let sdk; // WME SDK instance
  let settings = {};

  // =====================================================================
  // SEGMENT CACHING STATE (Phase 1: Smart viewport caching)
  // =====================================================================

  const renderedSegmentIds = new Set(); // Track which segments are currently rendered on the map
  const cachedHNsBySegment = new Map(); // Cache HN data: segmentId -> HN[] (persisted between pan events)
  const modifiedHNIds = new Set(); // Track HN IDs being edited (format: "segmentID/hnNumber")
  const modifiedHNOps = new Map(); // Track operation type for each HN: "moved", "updated", "deleted", "added"

  // =====================================================================
  // SETTINGS MANAGEMENT
  // =====================================================================

  /** Load settings from localStorage and apply defaults. */
  async function loadSettings() {
    const defaults = {
      disableBelowZoom: 17,
      enableTooltip: false, // Simplified: no tooltips with SDK
      hnLines: true,
      hnNumbers: true,
      markerPointRadius: 14,
      markerFontSize: 11,
      markerFillOpacity: 1.0,
      toggleHNNavPointsShortcut: null,
      toggleHNNavPointsNumbersShortcut: null,
      lastSaved: 0,
      lastVersion: undefined,
    };
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORE_NAME) || '{}');
    Object.assign(settings, defaults, saved);

    // Normalize shortcuts
    settings.toggleHNNavPointsShortcut = _normalizeShortcut(settings.toggleHNNavPointsShortcut);
    settings.toggleHNNavPointsNumbersShortcut = _normalizeShortcut(settings.toggleHNNavPointsNumbersShortcut);
  }

  /** Save settings to localStorage, capturing user-modified shortcuts from SDK. */
  function saveSettings() {
    settings.lastVersion = SCRIPT_VERSION;
    settings.lastSaved = Date.now();

    // Capture any user-modified shortcut keys from SDK
    const allShortcuts = sdk.Shortcuts.getAllShortcuts();
    allShortcuts.forEach((sc) => {
      if (sc.shortcutId === 'ToggleHNNavPointsShortcut') {
        settings.toggleHNNavPointsShortcut = _normalizeShortcut(sc.shortcutKeys);
      } else if (sc.shortcutId === 'ToggleHNNumbersShortcut') {
        settings.toggleHNNavPointsNumbersShortcut = _normalizeShortcut(sc.shortcutKeys);
      }
    });

    const toSave = {
      disableBelowZoom: settings.disableBelowZoom,
      hnLines: settings.hnLines,
      hnNumbers: settings.hnNumbers,
      markerPointRadius: settings.markerPointRadius,
      markerFontSize: settings.markerFontSize,
      markerFillOpacity: settings.markerFillOpacity,
      toggleHNNavPointsShortcut: settings.toggleHNNavPointsShortcut.raw,
      toggleHNNavPointsNumbersShortcut: settings.toggleHNNavPointsNumbersShortcut.raw,
      lastSaved: settings.lastSaved,
      lastVersion: settings.lastVersion,
    };
    localStorage.setItem(SETTINGS_STORE_NAME, JSON.stringify(toSave));
    logDebug('Settings saved');
  }

  // =====================================================================
  // LAYER CREATION & MANAGEMENT
  // =====================================================================

  /** Create and register SDK map layers for HN lines and markers with styleRules and layer switcher. */
  async function createLayers() {
    logDebug('Creating SDK layers...');

    // Create two layers: one for black outline, one for colored stroke

    sdk.Map.addLayer({
      layerName: LAYER_HN_LINES,
      zIndexing: true,
      styleRules: [
        {
          predicate: (props, zoomLevel) => zoomLevel >= settings.disableBelowZoom && settings.hnLines && props.type === 'hnLine',
          style: {
            stroke: true,
            fill: false,
            strokeColor: '#000000',
            strokeWidth: 4,
            strokeOpacity: 0.5,
            strokeDashstyle: 'dash',
          },
        },
        {
          style: { visible: false },
        },
      ],
    });

    // Colored stroke layer (on top of black outline)
    sdk.Map.addLayer({
      layerName: `${LAYER_HN_LINES}_colored`,
      zIndexing: true,
      styleRules: [
        {
          predicate: (props, zoomLevel) => zoomLevel >= settings.disableBelowZoom && settings.hnLines && props.type === 'hnLine',
          style: {
            stroke: true,
            fill: false,
            strokeColor: '${getStrokeColor}',
            strokeWidth: 2,
            strokeOpacity: 1,
            strokeDashstyle: 'dash',
          },
        },
        {
          style: { visible: false },
        },
      ],
      styleContext: {
        getStrokeColor: (context) => context?.feature?.properties?.strokeColor || '#FFFF00',
      },
    });

    sdk.Map.addLayer({
      layerName: LAYER_HN_MARKERS,
      zIndexing: true,
      styleRules: [
        {
          predicate: (props, zoomLevel) => zoomLevel >= settings.disableBelowZoom && settings.hnNumbers && props.type === 'hnMarker',
          style: {
            graphicName: 'square',
            pointRadius: '${getPointRadius}',
            fillColor: '${fillColor}',
            fillOpacity: '${getFillOpacity}',
            strokeColor: '#000000',
            strokeWidth: 2,
            label: '${hnNumber}',
            fontColor: '#000000',
            fontSize: '${getFontSize}',
            fontWeight: 'bold',
            fontFamily: 'Arial, sans-serif',
            labelYOffset: 2,
            labelOutlineWidth: 0,
          },
        },
        {
          style: { visible: false },
        },
      ],
      styleContext: {
        hnNumber: (context) => context?.feature?.properties?.hnNumber || '',
        fillColor: (context) => context?.feature?.properties?.fillColor || '#FFFFFF',
        getPointRadius: () => settings.markerPointRadius,
        getFontSize: () => `${settings.markerFontSize}px`,
        getFillOpacity: () => settings.markerFillOpacity,
      },
    });

    // Register layers in the layer switcher
    logDebug(`Creating layer checkboxes: hnLines=${settings.hnLines}, hnNumbers=${settings.hnNumbers}`);

    sdk.LayerSwitcher.addLayerCheckbox({
      name: 'HN NavPoints Lines',
      isChecked: settings.hnLines,
    });

    sdk.LayerSwitcher.addLayerCheckbox({
      name: 'HN NavPoints Numbers',
      isChecked: settings.hnNumbers,
    });

    logDebug('✓ Layers created and registered in WME Map layers');
  }

  // =====================================================================
  // GEOMETRY & GENERATION
  // =====================================================================

  /** Generate HN marker color based on forced/updatedBy state. Returns hex color string. */
  function generateHNColor(hnObject) {
    // Preserve original color logic from legacy script
    // Handle both property and method access patterns
    const isForced = typeof hnObject.isForced === 'function' ? hnObject.isForced() : (hnObject.isForced ?? hnObject.forced);

    const hasUpdatedBy = typeof hnObject.getUpdatedBy === 'function' ? hnObject.getUpdatedBy() : !!hnObject.updatedBy; // Convert to boolean - true if updatedBy exists

    if (isForced) {
      return hasUpdatedBy ? 'orange' : 'red';
    }
    return hasUpdatedBy ? 'white' : 'yellow';
  }

  /** Build a GeoJSON line feature for a house number connection line. */
  function buildHNLineFeature(hnData, segmentData) {
    if (!hnData?.geometry || !segmentData?.geometry) return null;

    // HN coordinates are in WGS84 (EPSG:4326)
    const hnCoords = hnData.geometry.coordinates;

    // Use fractionPoint (the navigation stop point on the segment) if available, otherwise fallback to segment start
    let navCoords = segmentData.geometry.coordinates[0];
    if (hnData.fractionPoint?.coordinates) {
      navCoords = hnData.fractionPoint.coordinates;
    }

    return {
      id: `line_seg${segmentData.id}_hn${hnData.id}`,
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [hnCoords, navCoords],
      },
      properties: {
        segmentId: segmentData.id,
        hnId: hnData.id,
        strokeColor: generateHNColor(hnData),
        type: 'hnLine', // Used by styleRules predicates
      },
    };
  }

  /** Build a GeoJSON point feature for a house number marker with SVG icon. */
  function buildHNMarkerFeature(hnData, segmentId) {
    if (!hnData?.geometry) return null;
    const color = generateHNColor(hnData);

    const colorMap = {
      red: '#FF0000',
      orange: '#FFA500',
      yellow: '#FFD700',
      white: '#FFFFFF',
    };

    return {
      id: `marker_seg${segmentId}_hn${hnData.id}`,
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: hnData.geometry.coordinates,
      },
      properties: {
        segmentId: segmentId,
        hnId: hnData.id,
        hnNumber: hnData.number || '',
        color: color,
        fillColor: colorMap[color] || '#FFFFFF',
        type: 'hnMarker',
      },
    };
  }

  // =====================================================================
  // FEATURE RENDERING
  // =====================================================================

  /** Remove all HN features from all layers. */
  function clearAllHNs() {
    logDebug('Clearing all HN features');
    sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_HN_LINES });
    sdk.Map.removeAllFeaturesFromLayer({ layerName: `${LAYER_HN_LINES}_colored` });
    sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_HN_MARKERS });
  }

  /** Build and add HN line and marker features to the map layers. */
  async function drawHNs(houseNumbersData) {
    if (!houseNumbersData || houseNumbersData.length === 0) return;

    // Filter to only HNs whose segments are loaded
    const hnsWithSegments = houseNumbersData.filter((hn) => {
      const segment = sdk.DataModel.Segments.getById({ segmentId: hn.segmentId });
      return !!segment;
    });

    if (hnsWithSegments.length < houseNumbersData.length) {
      logDebug(`Drawing ${hnsWithSegments.length}/${houseNumbersData.length} HNs (${houseNumbersData.length - hnsWithSegments.length} segments not yet loaded)`);
    } else {
      logDebug(`Drawing ${hnsWithSegments.length} HNs`);
    }

    const lineFeatures = [];
    const markerFeatures = [];

    for (const hnData of hnsWithSegments) {
      // Skip HNs being edited — let WME's native markers show draft positions
      const hnId = `${hnData.segmentId}/${hnData.number}`;
      if (modifiedHNIds.has(hnId)) {
        logDebug(`Skipping modified HN: ${hnId}`);
        continue;
      }

      try {
        // Get segment data for this HN (already verified it exists)
        const segment = sdk.DataModel.Segments.getById({ segmentId: hnData.segmentId });

        // Build line feature
        const lineFeature = buildHNLineFeature(hnData, segment);
        if (lineFeature) {
          lineFeatures.push(lineFeature);
        } else {
          logDebug(`Failed to build line feature for HN ${hnData.number}`);
        }

        // Build marker feature
        const markerFeature = buildHNMarkerFeature(hnData, segment.id);
        if (markerFeature) {
          markerFeatures.push(markerFeature);
        } else {
          logDebug(`Failed to build marker feature for HN ${hnData.number}`);
        }
      } catch (err) {
        logError(`Error building features for HN:`, err);
      }
    }

    // Add features to layers
    if (lineFeatures.length > 0) {
      try {
        logDebug(`Adding ${lineFeatures.length} line features to ${LAYER_HN_LINES}...`);
        sdk.Map.addFeaturesToLayer({
          features: lineFeatures,
          layerName: LAYER_HN_LINES,
        });
        // Also add to colored layer for the colored stroke effect
        sdk.Map.addFeaturesToLayer({
          features: lineFeatures,
          layerName: `${LAYER_HN_LINES}_colored`,
        });
        logDebug(`✓ Successfully added ${lineFeatures.length} line features to both layers`);
      } catch (err) {
        logError(`✗ Error adding ${lineFeatures.length} line features:`, err.message || String(err));
      }
    }

    if (markerFeatures.length > 0) {
      try {
        logDebug(`Adding ${markerFeatures.length} marker features to ${LAYER_HN_MARKERS}...`);
        sdk.Map.addFeaturesToLayer({
          features: markerFeatures,
          layerName: LAYER_HN_MARKERS,
        });
        logDebug(`✓ Successfully added ${markerFeatures.length} marker features`);
      } catch (err) {
        logError(`✗ Error adding ${markerFeatures.length} marker features:`, err.message || String(err));
      }
    }

    logDebug(`Built & Rendered ${lineFeatures.length} lines and ${markerFeatures.length} markers`);
  }

  // =====================================================================
  // DATA PROCESSING
  // =====================================================================

  /** Fetch segments in viewport, compute add/remove sets, and update cache/layers incrementally. */
  async function processSegmentsWithHNs() {
    const zoomLevel = sdk.Map.getZoomLevel();

    // Below zoom threshold: don't process, cache is preserved for when user zooms back in
    if (zoomLevel < settings.disableBelowZoom) {
      logDebug(`Below zoom threshold (${settings.disableBelowZoom}), skipping process`);
      return;
    }

    // Disabled: clear and return
    if (!settings.hnLines && !settings.hnNumbers) {
      logDebug('Both hnLines and hnNumbers disabled, skipping');
      clearCache();
      return;
    }

    try {
      // PHASE 2: Smart viewport-based caching
      // Get current segments with house numbers in viewport
      const allSegments = sdk.DataModel.Segments.getAll();
      const currentSegmentIds = new Set(allSegments.filter((s) => s?.hasHouseNumbers === true).map((s) => s.id));

      if (currentSegmentIds.size === 0) {
        logDebug('No segments with house numbers in viewport');
        return;
      }

      // Identify changes
      const toAdd = [...currentSegmentIds].filter((id) => !renderedSegmentIds.has(id));
      const toRemove = [...renderedSegmentIds].filter((id) => !currentSegmentIds.has(id));
      const unchanged = renderedSegmentIds.size - toRemove.length;

      logDebug(`Viewport: ${currentSegmentIds.size} total, +${toAdd.length} new, -${toRemove.length} left, ${unchanged} unchanged (cache)`);

      // Remove old segments (those that left viewport)
      if (toRemove.length > 0) {
        await removeOldSegmentHNs(toRemove);
      }

      // Add new segments (those entering viewport)
      if (toAdd.length > 0) {
        await addNewSegmentHNs(toAdd);
      }

      // Log cache summary
      const totalCachedHNs = [...cachedHNsBySegment.values()].reduce((sum, arr) => sum + arr.length, 0);
      logDebug(`Cache summary: ${renderedSegmentIds.size} segments, ${totalCachedHNs} HNs total`);
    } catch (error) {
      logError(`Error in processSegmentsWithHNs:`, error.message || error);
    }
  }

  // =====================================================================
  // CACHING HELPER FUNCTIONS
  // =====================================================================

  /**
   * Rebuild all layers from cachedHNsBySegment map (used after removing segments)
   * Much faster than fetching fresh data since HNs are already cached
   */
  /** Clear layers and rebuild all features from cache (used when segments leave viewport). */
  function rebuildLayersFromCache() {
    const lineFeatures = [];
    const markerFeatures = [];

    for (const [segmentId, hnsArray] of cachedHNsBySegment) {
      const segment = sdk.DataModel.Segments.getById({ segmentId });
      if (!segment) {
        logDebug(`rebuildLayersFromCache: Segment ${segmentId} not found, skipping`);
        continue;
      }

      for (const hnData of hnsArray) {
        // Skip HNs being edited — let WME's native markers show draft positions
        const hnId = `${segmentId}/${hnData.number}`;
        if (modifiedHNIds.has(hnId)) {
          logDebug(`rebuildLayersFromCache: Skipping modified HN ${hnId}`);
          continue;
        }

        try {
          const lineFeature = buildHNLineFeature(hnData, segment);
          if (lineFeature) lineFeatures.push(lineFeature);

          const markerFeature = buildHNMarkerFeature(hnData, segment.id);
          if (markerFeature) markerFeatures.push(markerFeature);
        } catch (err) {
          logError(`Error rebuilding features for HN ${hnData.number}:`, err);
        }
      }
    }

    // Clear and add all features back
    sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_HN_LINES });
    sdk.Map.removeAllFeaturesFromLayer({ layerName: `${LAYER_HN_LINES}_colored` });
    sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_HN_MARKERS });

    if (lineFeatures.length > 0) {
      sdk.Map.addFeaturesToLayer({ features: lineFeatures, layerName: LAYER_HN_LINES });
      sdk.Map.addFeaturesToLayer({ features: lineFeatures, layerName: `${LAYER_HN_LINES}_colored` });
    }

    if (markerFeatures.length > 0) {
      sdk.Map.addFeaturesToLayer({ features: markerFeatures, layerName: LAYER_HN_MARKERS });
    }

    logDebug(`rebuildLayersFromCache: Re-rendered ${lineFeatures.length} lines and ${markerFeatures.length} markers from cache`);
  }

  /**
   * Add new segments to cache and render their HNs
   * Only fetches + renders HNs for segments not yet in renderedSegmentIds
   */
  /** Fetch and cache HNs for new segments entering viewport, then render them. */
  async function addNewSegmentHNs(segmentIds) {
    if (!segmentIds || segmentIds.length === 0) return 0;

    const startTime = performance.now();
    const newSegmentIds = segmentIds.filter((id) => !renderedSegmentIds.has(id));

    if (newSegmentIds.length === 0) {
      logDebug('addNewSegmentHNs: All segments already rendered');
      return 0;
    }

    logDebug(`addNewSegmentHNs: Fetching ${newSegmentIds.length} new segments...`);

    // Fetch HNs for new segments in batches
    const BATCH_SIZE = 100;
    const newHNs = [];
    let totalHNCount = 0;

    for (let i = 0; i < newSegmentIds.length; i += BATCH_SIZE) {
      const batch = newSegmentIds.slice(i, i + BATCH_SIZE);
      try {
        const batchHNs = await sdk.DataModel.HouseNumbers.fetchHouseNumbers({ segmentIds: batch });
        if (batchHNs && batchHNs.length > 0) {
          newHNs.push(...batchHNs);

          // Cache HNs by segment ID
          const hnsBySegment = {};
          batchHNs.forEach((hn) => {
            if (!hnsBySegment[hn.segmentId]) hnsBySegment[hn.segmentId] = [];
            hnsBySegment[hn.segmentId].push(hn);
          });

          for (const [segId, hns] of Object.entries(hnsBySegment)) {
            cachedHNsBySegment.set(parseInt(segId), hns);
            totalHNCount += hns.length;
          }
        }
      } catch (err) {
        logError(`addNewSegmentHNs batch error:`, err);
      }
    }

    // Draw the new HNs
    if (newHNs.length > 0) {
      await drawHNs(newHNs);
    }

    // Mark segments as rendered
    newSegmentIds.forEach((id) => renderedSegmentIds.add(id));

    const elapsed = performance.now() - startTime;
    log(`Added ${newSegmentIds.length} segments (${totalHNCount} HNs) in ${elapsed.toFixed(0)}ms`);
    return newSegmentIds.length;
  }

  /**
   * Remove segments that left the viewport
   * Rebuilds layers from remaining cache (faster than full fetch)
   */
  /** Remove segments from cache and rebuild layers from remaining segments. */
  async function removeOldSegmentHNs(segmentIds) {
    if (!segmentIds || segmentIds.length === 0) return 0;

    const startTime = performance.now();
    let removedHNCount = 0;

    for (const segmentId of segmentIds) {
      renderedSegmentIds.delete(segmentId);
      const hnCount = cachedHNsBySegment.get(segmentId)?.length || 0;
      cachedHNsBySegment.delete(segmentId);
      removedHNCount += hnCount;
    }

    // Rebuild layers from remaining cache
    rebuildLayersFromCache();

    const elapsed = performance.now() - startTime;
    log(`Removed ${segmentIds.length} segments (${removedHNCount} HNs) in ${elapsed.toFixed(0)}ms`);
    return segmentIds.length;
  }

  /**
   * Clear all cache and layers (used on zoom level changes or save events)
   */
  /** Clear all cached segments and HN data, and remove all features from layers. */
  function clearCache() {
    renderedSegmentIds.clear();
    cachedHNsBySegment.clear();
    clearAllHNs();
    logDebug('Cache cleared (renderedSegmentIds and cachedHNsBySegment)');
  }

  // =====================================================================
  // EVENT LISTENERS
  // =====================================================================

  /** Register SDK event listeners for map data, segment saves, zoom changes, and layer toggles. */
  function setupEventListeners() {
    logDebug('Setting up event listeners');

    // Map data loaded — fires when WME fetches segments from server
    sdk.Events.on({
      eventName: 'wme-map-data-loaded',
      eventHandler: () => processSegmentsWithHNs(),
    });

    // Refresh modified HNs when save completes
    sdk.Events.on({
      eventName: 'wme-save-finished',
      eventHandler: async (event) => {
        if (!event.success || modifiedHNIds.size === 0) {
          logDebug(`Save finished but no modified HNs to refresh (success=${event.success}, modifiedHNs=${modifiedHNIds.size})`);
          return;
        }

        logDebug(`Save finished! Refreshing ${modifiedHNIds.size} modified HNs`);

        // Check if any HNs were added (they have a different ID format, just a number, or operation type is "added")
        const hasAddedHNs = [...modifiedHNIds].some((hnId) => {
          const isNumeric = typeof hnId === 'number' || (typeof hnId === 'string' && !/\//.test(hnId));
          const isAddedOp = modifiedHNOps.get(hnId) === 'added';
          return isNumeric || isAddedOp;
        });

        if (hasAddedHNs) {
          logDebug(`New HNs detected; doing full viewport refresh`);
          // For added HNs, we don't know which segment they belong to until we re-fetch all segments
          modifiedHNIds.clear();
          modifiedHNOps.clear();
          clearCache();
          await processSegmentsWithHNs();
          log(`✓ HN display updated after save`);
          return;
        }

        // Extract segment IDs from modified HNs (format: "segmentID/hnNumber")
        const modifiedSegmentIds = new Set(
          [...modifiedHNIds]
            .map((hnId) => {
              // Skip non-string IDs (added HNs are numbers, shouldn't reach here, but be defensive)
              if (typeof hnId !== 'string') {
                logDebug(`Skipping non-string HN ID: ${hnId}`);
                return null;
              }
              const parts = hnId.split('/');
              return parts.length === 2 ? parseInt(parts[0], 10) : null;
            })
            .filter((id) => id !== null)
        );

        try {
          // Fetch fresh HN data for modified segments (now persisted)
          const updatedHNs = await sdk.DataModel.HouseNumbers.fetchHouseNumbers({
            segmentIds: Array.from(modifiedSegmentIds),
          });

          logDebug(`Fetched ${updatedHNs?.length || 0} HNs from API`);

          // Build set of HN IDs that should exist after save
          const apiHNIds = new Set(updatedHNs?.map(hn => hn.id) || []);

          if (updatedHNs && updatedHNs.length > 0) {
            // Update cache with fresh persisted data
            updatedHNs.forEach((hn) => {
              const segId = hn.segmentId;
              const existing = cachedHNsBySegment.get(segId) || [];
              // Replace old HN with updated one (by ID), or add if new
              const filtered = existing.filter((h) => h.id !== hn.id);
              filtered.push(hn);
              cachedHNsBySegment.set(segId, filtered);

              // For new HNs: ensure segment is marked as rendered so we don't re-fetch it
              if (!renderedSegmentIds.has(segId)) {
                renderedSegmentIds.add(segId);
                logDebug(`Added segment ${segId} to rendered set (new HN)`);
              }
            });

            logDebug(`Updated cache: ${updatedHNs.length} HNs with persisted data`);
          }

          // Handle deleted HNs: remove any HNs from cache that were in modifiedHNIds but aren't in the fresh API response
          for (const modifiedHNId of modifiedHNIds) {
            const [segIdStr, hnNumber] = modifiedHNId.split('/');
            const segId = parseInt(segIdStr, 10);
            const cachedHNs = cachedHNsBySegment.get(segId);

            if (cachedHNs) {
              const beforeCount = cachedHNs.length;
              // Remove HNs that are no longer in the API response (i.e., they were deleted)
              const filtered = cachedHNs.filter((h) => {
                // Check if this HN exists in the fresh API response
                return updatedHNs?.some(apiHN => apiHN.id === h.id);
              });

              if (filtered.length < beforeCount) {
                const removedCount = beforeCount - filtered.length;
                logDebug(`Removed ${removedCount} deleted HN(s) from segment ${segId}`);
                cachedHNsBySegment.set(segId, filtered);
              }
            }
          }
        } catch (err) {
          logError(`Error re-fetching modified segments after save:`, err);
        }

        // Clear modification tracking and rebuild layers
        modifiedHNIds.clear();
        modifiedHNOps.clear();
        rebuildLayersFromCache();
        log(`✓ HN display updated after save`);
      },
    });

    // Zoom level changed — toggle visibility based on threshold, preserve cache
    sdk.Events.on({
      eventName: 'wme-map-zoom-changed',
      eventHandler: () => {
        const zoomLevel = sdk.Map.getZoomLevel();
        const threshold = settings.disableBelowZoom;
        logDebug(`Zoom level changed to: ${zoomLevel}`);

        if (zoomLevel >= threshold) {
          // Above threshold: ensure layers visible and process segments
          sdk.Map.setLayerVisibility({ layerName: LAYER_HN_LINES, visibility: settings.hnLines });
          sdk.Map.setLayerVisibility({ layerName: `${LAYER_HN_LINES}_colored`, visibility: settings.hnLines });
          sdk.Map.setLayerVisibility({ layerName: LAYER_HN_MARKERS, visibility: settings.hnNumbers });
          processSegmentsWithHNs(); // Smart cache handles viewport delta
        } else {
          // Below threshold: hide layers but keep cache intact for when user zooms back in
          logDebug(`Below zoom threshold (${threshold}), hiding layers but preserving cache`);
          sdk.Map.setLayerVisibility({ layerName: LAYER_HN_LINES, visibility: false });
          sdk.Map.setLayerVisibility({ layerName: `${LAYER_HN_LINES}_colored`, visibility: false });
          sdk.Map.setLayerVisibility({ layerName: LAYER_HN_MARKERS, visibility: false });
        }
      },
    });

    // Layer switcher checkbox toggled
    sdk.Events.on({
      eventName: 'wme-layer-checkbox-toggled',
      eventHandler: async (checkboxInfo) => {
        logDebug(`Layer checkbox event:`, checkboxInfo);

        if (checkboxInfo.name === 'HN NavPoints Lines') {
          settings.hnLines = checkboxInfo.checked;
          logDebug(`HN Lines layer toggled: ${checkboxInfo.checked}`);
          // Set layer visibility directly
          sdk.Map.setLayerVisibility({ layerName: LAYER_HN_LINES, visibility: checkboxInfo.checked });
          sdk.Map.setLayerVisibility({ layerName: `${LAYER_HN_LINES}_colored`, visibility: checkboxInfo.checked });
          // Redraw to re-evaluate predicates
          sdk.Map.redrawLayer({ layerName: LAYER_HN_LINES });
          sdk.Map.redrawLayer({ layerName: `${LAYER_HN_LINES}_colored` });
          saveSettings();
        }
        if (checkboxInfo.name === 'HN NavPoints Numbers') {
          settings.hnNumbers = checkboxInfo.checked;
          logDebug(`HN Numbers layer toggled: ${checkboxInfo.checked}`);
          // Set layer visibility directly
          sdk.Map.setLayerVisibility({ layerName: LAYER_HN_MARKERS, visibility: checkboxInfo.checked });
          // Redraw to re-evaluate predicates
          sdk.Map.redrawLayer({ layerName: LAYER_HN_MARKERS });
          saveSettings();
        }
      },
    });

    // Track real-time HN edits (moved, updated, deleted, added)
    // These fire before save; we skip rendering modified HNs and let WME's native markers show drafts
    sdk.Events.on({
      eventName: 'wme-house-number-moved',
      eventHandler: (payload) => {
        modifiedHNIds.add(payload.houseNumberId);
        modifiedHNOps.set(payload.houseNumberId, 'moved');
        logDebug(`HN moved: ${payload.houseNumberId}`);
        rebuildLayersFromCache();
      },
    });

    sdk.Events.on({
      eventName: 'wme-house-number-updated',
      eventHandler: (payload) => {
        modifiedHNIds.add(payload.houseNumberId);
        modifiedHNOps.set(payload.houseNumberId, 'updated');
        logDebug(`HN updated: ${payload.houseNumberId}`);
        rebuildLayersFromCache();
      },
    });

    sdk.Events.on({
      eventName: 'wme-house-number-deleted',
      eventHandler: (payload) => {
        modifiedHNIds.add(payload.houseNumberId);
        modifiedHNOps.set(payload.houseNumberId, 'deleted');
        logDebug(`HN deleted: ${payload.houseNumberId}`);
        rebuildLayersFromCache();
      },
    });

    sdk.Events.on({
      eventName: 'wme-house-number-added',
      eventHandler: (payload) => {
        modifiedHNIds.add(payload.houseNumberId);
        modifiedHNOps.set(payload.houseNumberId, 'added');
        logDebug(`HN added: ${payload.houseNumberId}`);
        rebuildLayersFromCache();
      },
    });
  }

  // =====================================================================
  // SHORTCUTS
  // =====================================================================

  /** Shortcut callback to toggle HN lines layer visibility. */
  function onToggleHNLinesShortcut() {
    try {
      settings.hnLines = !settings.hnLines;
      sdk.Map.setLayerVisibility({ layerName: LAYER_HN_LINES, visibility: settings.hnLines });
      sdk.Map.setLayerVisibility({ layerName: `${LAYER_HN_LINES}_colored`, visibility: settings.hnLines });
      sdk.Map.redrawLayer({ layerName: LAYER_HN_LINES });
      sdk.Map.redrawLayer({ layerName: `${LAYER_HN_LINES}_colored` });
      saveSettings();
    } catch (err) {
      logError('Error toggling HN Lines layer:', err);
    }
  }

  /** Shortcut callback to toggle HN numbers layer visibility. */
  function onToggleHNNumbersShortcut() {
    try {
      settings.hnNumbers = !settings.hnNumbers;
      sdk.Map.setLayerVisibility({ layerName: LAYER_HN_MARKERS, visibility: settings.hnNumbers });
      sdk.Map.redrawLayer({ layerName: LAYER_HN_MARKERS });
      saveSettings();
    } catch (err) {
      logError('Error toggling HN Numbers layer:', err);
    }
  }

  /** Register keyboard shortcuts for toggling HN layers, with conflict detection and key binding restoration. */
  function setupShortcuts() {
    logDebug('Setting up shortcuts');

    const shortcutDefs = [
      {
        id: 'ToggleHNNavPointsShortcut',
        desc: 'Toggle HN NavPoints Lines',
        settingsKey: 'toggleHNNavPointsShortcut',
        defaultKey: 'S+N',
        cb: onToggleHNLinesShortcut,
      },
      {
        id: 'ToggleHNNumbersShortcut',
        desc: 'Toggle HN NavPoints Numbers',
        settingsKey: 'toggleHNNavPointsNumbersShortcut',
        defaultKey: 'S+M',
        cb: onToggleHNNumbersShortcut,
      },
    ];

    for (const sc of shortcutDefs) {
      // Delete old registration on script reload
      if (sdk.Shortcuts.isShortcutRegistered({ shortcutId: sc.id })) {
        sdk.Shortcuts.deleteShortcut({ shortcutId: sc.id });
      }

      // Normalize stored shortcut
      settings[sc.settingsKey] = _normalizeShortcut(settings[sc.settingsKey]);

      // Restore default if not set
      if (settings[sc.settingsKey].combo == null && sc.defaultKey) {
        settings[sc.settingsKey] = _normalizeShortcut(sc.defaultKey);
      }

      // Check for key conflicts BEFORE attempting to register
      let shortcutKeys = settings[sc.settingsKey].combo;
      if (shortcutKeys && sdk.Shortcuts.areShortcutKeysInUse({ shortcutKeys })) {
        logDebug(`"${sc.desc}" key conflict (${shortcutKeys}), registering without key`);
        shortcutKeys = null;
        settings[sc.settingsKey] = { raw: null, combo: null };
      }

      try {
        sdk.Shortcuts.createShortcut({
          shortcutId: sc.id,
          description: sc.desc,
          callback: sc.cb,
          shortcutKeys,
        });
      } catch (ex) {
        logError(`Unable to register shortcut ${sc.id}:`, ex);
      }
    }

    logDebug(`Shortcuts setup complete (${shortcutDefs.length} shortcuts processed)`);
  }

  // =====================================================================
  // SIDEBAR UI
  // =====================================================================

  /** Create sidebar panel with marker styling controls and layer checkboxes. */
  async function setupUI() {
    logDebug('Setting up sidebar UI');

    const { tabLabel, tabPane } = await sdk.Sidebar.registerScriptTab({
      tabName: 'HN-NavPoints',
      tabLabel: 'HN NavPoints',
    });

    tabLabel.innerHTML = '<i class="w-icon w-icon-location" style="font-size:15px;padding-top:4px;"></i>';
    tabLabel.title = _SCRIPT_SHORT_NAME;

    // ── CSS (scoped to .wme-hnp-panel) ─────────────────────────────────
    const style = document.createElement('style');
    style.textContent = [
      '.wme-hnp-panel { padding: 8px; box-sizing: border-box; }',
      '.wme-hnp-panel .hnp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 8px 10px; background: linear-gradient(135deg, #006bb3, #0052a3); color: #fff; border-radius: 8px; }',
      '.wme-hnp-panel .hnp-header-left { display: flex; align-items: center; gap: 6px; }',
      '.wme-hnp-panel .hnp-header-icon { color: #fff; font-size: 1.2em; }',
      '.wme-hnp-panel .hnp-header-name { font-weight: 700; font-size: 13px; color: #fff; }',
      '.wme-hnp-panel .hnp-header-version { font-size: 10px; opacity: 0.8; color: #fff; }',
      '.wme-hnp-panel .hnp-card { border: 1px solid var(--hairline, #ddd); border-radius: 8px; margin-bottom: 8px; overflow: hidden; }',
      '.wme-hnp-panel .hnp-card-header { display: flex; align-items: center; gap: 7px; padding: 7px 10px; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--hairline, #ddd); background: linear-gradient(135deg, #f8f9fa, #f0f1f3); color: #333; }',
      '.wme-hnp-panel .hnp-card-header:hover { background: linear-gradient(135deg, #f0f1f3, #e8eaed); }',
      '.wme-hnp-panel .hnp-card-header i { color: #006bb3; font-size: 11px; width: 14px; text-align: center; }',
      '.wme-hnp-panel .hnp-card-body { padding: 2px 0; }',
      '.wme-hnp-panel .hnp-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 10px; min-height: 32px; box-sizing: border-box; }',
      '.wme-hnp-panel .hnp-row-label { flex: 1; font-size: 12px; padding-right: 8px; line-height: 1.3; }',
      '.wme-hnp-panel input[type="number"] { font-size: 12px; border: 1px solid var(--hairline, #ccc); border-radius: 4px; padding: 3px 5px; width: 60px; text-align: right; box-sizing: border-box; background: var(--background_default, #fff); color: var(--content_default, #333); }',
      '.wme-hnp-panel .hnp-toggle { position: relative; display: inline-block; width: 34px; height: 18px; flex-shrink: 0; }',
      '.wme-hnp-panel .hnp-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }',
      '.wme-hnp-panel .hnp-toggle-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; border-radius: 18px; transition: background-color 0.2s; }',
      '.wme-hnp-panel .hnp-toggle-slider:before { position: absolute; content: ""; height: 12px; width: 12px; left: 3px; bottom: 3px; background-color: white; border-radius: 50%; transition: transform 0.2s; }',
      '.wme-hnp-panel .hnp-toggle input:checked + .hnp-toggle-slider { background-color: #00bd00; }',
      '.wme-hnp-panel .hnp-toggle input:checked + .hnp-toggle-slider:before { transform: translateX(16px); }',
      '.wme-hnp-panel .hnp-legend { padding: 2px 0; }',
      '.wme-hnp-panel .hnp-legend-item { display: flex; align-items: center; gap: 8px; padding: 5px 10px 5px 20px; min-height: 28px; font-size: 11px; }',
      '.wme-hnp-panel .hnp-legend-color { width: 14px; height: 14px; border-radius: 2px; border: 1px solid rgba(0,0,0,0.2); flex-shrink: 0; }',
      '[wz-theme="dark"] .wme-hnp-panel .hnp-header { background: linear-gradient(135deg, #0052a3, #003d7a); }',
      '[wz-theme="dark"] .wme-hnp-panel .hnp-card-header { background: linear-gradient(135deg, #2a2c30, #202124); color: #e8eaed; }',
      '[wz-theme="dark"] .wme-hnp-panel .hnp-card-header:hover { background: linear-gradient(135deg, #333538, #2a2c30); }',
      '[wz-theme="dark"] .wme-hnp-panel .hnp-card-header i { color: #33ccff; }',
    ].join('\n');

    // ── Helper functions ───────────────────────────────────────────────
    function makeCard(iconClass, title) {
      const card = document.createElement('div');
      card.className = 'hnp-card';
      const cardHeader = document.createElement('div');
      cardHeader.className = 'hnp-card-header';
      const icon = document.createElement('i');
      icon.className = 'fa ' + iconClass;
      const titleSpan = document.createElement('span');
      titleSpan.textContent = title;
      cardHeader.appendChild(icon);
      cardHeader.appendChild(titleSpan);
      card.appendChild(cardHeader);
      const body = document.createElement('div');
      body.className = 'hnp-card-body';
      card.appendChild(body);
      return { card, body };
    }

    function makeRow(labelText, control) {
      const row = document.createElement('div');
      row.className = 'hnp-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'hnp-row-label';
      labelEl.textContent = labelText;
      row.appendChild(labelEl);
      row.appendChild(control);
      return row;
    }

    function makeToggle(id, checked = false) {
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'hnp-toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      if (checked) input.checked = true;
      const slider = document.createElement('span');
      slider.className = 'hnp-toggle-slider';
      toggleLabel.appendChild(input);
      toggleLabel.appendChild(slider);
      return { label: toggleLabel, input };
    }

    function makeNumber(id, value, min = 16, max = 22) {
      const input = document.createElement('input');
      input.type = 'number';
      input.id = id;
      input.value = value;
      input.min = min;
      input.max = max;
      return input;
    }

    // ── Build panel with all content ───────────────────────────────────
    const panelDiv = document.createElement('div');
    panelDiv.className = 'wme-hnp-panel';

    // Script header
    const header = document.createElement('div');
    header.className = 'hnp-header';
    const headerLeft = document.createElement('div');
    headerLeft.className = 'hnp-header-left';
    const headerIcon = document.createElement('i');
    headerIcon.className = 'fa fa-location-arrow hnp-header-icon';
    const headerName = document.createElement('span');
    headerName.className = 'hnp-header-name';
    headerName.textContent = _SCRIPT_LONG_NAME;
    headerLeft.appendChild(headerIcon);
    headerLeft.appendChild(headerName);
    const headerVersion = document.createElement('span');
    headerVersion.className = 'hnp-header-version';
    headerVersion.textContent = `v${SCRIPT_VERSION}`;
    header.appendChild(headerLeft);
    header.appendChild(headerVersion);
    panelDiv.appendChild(header);

    // Settings card
    const settingsCard = makeCard('fa-cog', 'Settings');
    const zoomInput = makeNumber('hnNP_disableZoom', settings.disableBelowZoom);
    settingsCard.body.appendChild(makeRow('Min zoom level:', zoomInput));
    panelDiv.appendChild(settingsCard.card);

    // Marker styling card
    const markerCard = makeCard('fa-paint-brush', 'Marker Styling');
    const radiusControl = document.createElement('div');
    radiusControl.style.display = 'flex';
    radiusControl.style.alignItems = 'center';
    radiusControl.style.gap = '8px';
    radiusControl.style.padding = '5px 10px';

    const radiusLabel = document.createElement('span');
    radiusLabel.textContent = 'Size:';
    radiusLabel.style.fontSize = '12px';
    radiusLabel.style.minWidth = '60px';

    const radiusSlider = document.createElement('input');
    radiusSlider.type = 'range';
    radiusSlider.id = 'hnNP_markerRadius';
    radiusSlider.min = '8';
    radiusSlider.max = '24';
    radiusSlider.step = '1';
    radiusSlider.value = settings.markerPointRadius;
    radiusSlider.style.flex = '1';
    radiusSlider.style.cursor = 'pointer';

    const radiusValue = document.createElement('span');
    radiusValue.id = 'hnNP_radiusValue';
    radiusValue.textContent = settings.markerPointRadius;
    radiusValue.style.fontSize = '12px';
    radiusValue.style.minWidth = '20px';
    radiusValue.style.textAlign = 'right';

    radiusControl.appendChild(radiusLabel);
    radiusControl.appendChild(radiusSlider);
    radiusControl.appendChild(radiusValue);
    markerCard.body.appendChild(radiusControl);

    const fontControl = document.createElement('div');
    fontControl.style.display = 'flex';
    fontControl.style.alignItems = 'center';
    fontControl.style.gap = '8px';
    fontControl.style.padding = '5px 10px';

    const fontLabel = document.createElement('span');
    fontLabel.textContent = 'Font:';
    fontLabel.style.fontSize = '12px';
    fontLabel.style.minWidth = '60px';

    const fontSlider = document.createElement('input');
    fontSlider.type = 'range';
    fontSlider.id = 'hnNP_markerFont';
    fontSlider.min = '8';
    fontSlider.max = '16';
    fontSlider.step = '1';
    fontSlider.value = settings.markerFontSize;
    fontSlider.style.flex = '1';
    fontSlider.style.cursor = 'pointer';

    const fontValue = document.createElement('span');
    fontValue.id = 'hnNP_fontValue';
    fontValue.textContent = settings.markerFontSize + 'px';
    fontValue.style.fontSize = '12px';
    fontValue.style.minWidth = '28px';
    fontValue.style.textAlign = 'right';

    fontControl.appendChild(fontLabel);
    fontControl.appendChild(fontSlider);
    fontControl.appendChild(fontValue);
    markerCard.body.appendChild(fontControl);

    const opacityControl = document.createElement('div');
    opacityControl.style.display = 'flex';
    opacityControl.style.alignItems = 'center';
    opacityControl.style.gap = '8px';
    opacityControl.style.padding = '5px 10px';

    const opacityLabel = document.createElement('span');
    opacityLabel.textContent = 'Opacity:';
    opacityLabel.style.fontSize = '12px';
    opacityLabel.style.minWidth = '60px';

    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.id = 'hnNP_markerOpacity';
    opacitySlider.min = '0.1';
    opacitySlider.max = '1.0';
    opacitySlider.step = '0.1';
    opacitySlider.value = settings.markerFillOpacity;
    opacitySlider.style.flex = '1';
    opacitySlider.style.cursor = 'pointer';

    const opacityValue = document.createElement('span');
    opacityValue.id = 'hnNP_opacityValue';
    opacityValue.textContent = (settings.markerFillOpacity * 100).toFixed(0) + '%';
    opacityValue.style.fontSize = '12px';
    opacityValue.style.minWidth = '28px';
    opacityValue.style.textAlign = 'right';

    opacityControl.appendChild(opacityLabel);
    opacityControl.appendChild(opacitySlider);
    opacityControl.appendChild(opacityValue);
    markerCard.body.appendChild(opacityControl);

    panelDiv.appendChild(markerCard.card);

    // Legend card
    const legendCard = makeCard('fa-eyedropper', 'Color Legend');
    const legendBody = legendCard.body;
    legendBody.className += ' hnp-legend';
    const legendData = [
      { color: '#cc0000', label: 'Forced (untouched)' },
      { color: '#ff8800', label: 'Forced (touched)' },
      { color: '#ffff00', label: 'Updated (untouched)' },
      { color: '#ffffff', label: 'Updated (touched)', borderColor: '#000000' },
    ];
    legendData.forEach(({ color, label, borderColor }) => {
      const item = document.createElement('div');
      item.className = 'hnp-legend-item';
      const swatch = document.createElement('div');
      swatch.className = 'hnp-legend-color';
      swatch.style.backgroundColor = color;
      if (borderColor) swatch.style.borderColor = borderColor;
      const text = document.createElement('span');
      text.textContent = label;
      item.appendChild(swatch);
      item.appendChild(text);
      legendBody.appendChild(item);
    });
    panelDiv.appendChild(legendCard.card);

    // Render to tabPane (append style then panel)
    tabPane.appendChild(style);
    tabPane.appendChild(panelDiv);

    // ── Event listeners for settings ───────────────────────────────────
    zoomInput.addEventListener('change', (e) => {
      settings.disableBelowZoom = Math.min(22, Math.max(16, parseInt(e.target.value, 10)));
      e.target.value = settings.disableBelowZoom;
      saveSettings();
    });

    // Marker radius slider
    radiusSlider.addEventListener('input', (e) => {
      const newRadius = parseInt(e.target.value, 10);
      settings.markerPointRadius = newRadius;
      radiusValue.textContent = newRadius;
      sdk.Map.redrawLayer({ layerName: LAYER_HN_MARKERS });
      logDebug(`Marker point radius: ${newRadius}`);
    });

    radiusSlider.addEventListener('change', () => {
      saveSettings();
    });

    // Marker font size slider
    fontSlider.addEventListener('input', (e) => {
      const newSize = parseInt(e.target.value, 10);
      settings.markerFontSize = newSize;
      fontValue.textContent = newSize + 'px';
      sdk.Map.redrawLayer({ layerName: LAYER_HN_MARKERS });
      logDebug(`Marker font size: ${newSize}px`);
    });

    fontSlider.addEventListener('change', () => {
      saveSettings();
    });

    // Marker fill opacity slider
    opacitySlider.addEventListener('input', (e) => {
      const newOpacity = parseFloat(e.target.value);
      settings.markerFillOpacity = newOpacity;
      opacityValue.textContent = (newOpacity * 100).toFixed(0) + '%';
      sdk.Map.redrawLayer({ layerName: LAYER_HN_MARKERS });
      logDebug(`Marker fill opacity: ${(newOpacity * 100).toFixed(0)}%`);
    });

    opacitySlider.addEventListener('change', () => {
      saveSettings();
    });

    // Save settings on page unload (captures user-modified shortcuts from WME UI)
    window.addEventListener('beforeunload', saveSettings, false);
  }

  // =====================================================================
  // UPDATE SYSTEM
  // =====================================================================
  /**
   * Displays the WazeWrap "script updated" notification banner when the script version changes.
   * Compares current version against the previously saved version in settings.
   */
  /** Display script update notification if version has changed. */
  function showScriptInfoAlert() {
    if (SHOW_UPDATE_MESSAGE && SCRIPT_VERSION !== settings.lastVersion) {
      let releaseNotes = "<p>What's New:</p>";
      if (SCRIPT_VERSION_CHANGES.length > 0) {
        releaseNotes += '<ul>' + SCRIPT_VERSION_CHANGES.map((change) => `<li>${change}</li>`).join('') + '</ul>';
      } else {
        releaseNotes += '<ul><li>Nothing major.</li></ul>';
      }
      WazeWrap.Interface.ShowScriptUpdate(GM_info.script.name, SCRIPT_VERSION, releaseNotes, DOWNLOAD_URL);
      settings.lastVersion = SCRIPT_VERSION;
      saveSettings();
    }
  }

  // =====================================================================
  // INITIALIZATION
  // =====================================================================

  /** Initialize the script: bootstrap SDK, load settings, create layers, setup UI/events/shortcuts, process initial segments. */
  async function initialize() {
    try {
      log(`Initializing v${SCRIPT_VERSION}`);

      // Get SDK using bootstrap() pattern (like WMEPIE)
      sdk = await bootstrap({
        scriptName: _SCRIPT_LONG_NAME,
        scriptUpdateMonitor: {
          downloadUrl: DOWNLOAD_URL,
          scriptVersion: SCRIPT_VERSION,
        },
      });
      logDebug('SDK ready');

      // Load settings
      await loadSettings();
      logDebug('Settings loaded');

      // Create layers
      await createLayers();

      // Setup UI (includes marker styling controls)
      await setupUI();

      // Setup event listeners
      setupEventListeners();

      // Setup shortcuts
      setupShortcuts();

      //Check for Script Updates
      showScriptInfoAlert();

      // Process initial segments
      await processSegmentsWithHNs(); // Handles zoom check and segment fetching internally

      const elapsed = Math.round(performance.now() - _LOAD_BEGIN_TIME);
      log(`Fully initialized in ${elapsed}ms`);
    } catch (error) {
      logError('Initialization failed:', error);
    }
  }

  // Start initialization
  initialize();
})();
