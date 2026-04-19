// ==UserScript==
// @name            WME HN NavPoints
// @namespace       https://greasyfork.org/users/166843
// @description     Shows navigation points of all house numbers in WME
// @version         2026.04.19.05
// @author          dBsooner
// @grant           GM_info
// @grant           GM_xmlhttpRequest
// @grant           unsafeWindow
// @connect         greasyfork.org
// @require         https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js
// @require         https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @license         GPLv3
// @include         /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor.*$/
// @contributionURL https://github.com/WazeDev/Thank-The-Authors
// @downloadURL https://update.greasyfork.org/scripts/390565/WME%20HN%20NavPoints.user.js
// @updateURL https://update.greasyfork.org/scripts/390565/WME%20HN%20NavPoints.meta.js
// ==/UserScript==

/* global _, GM_info, GM_xmlhttpRequest, W, WazeWrap, getWmeSdk, turf */

/*
 * Original concept and code for WME HN NavPoints was written by MajkiiTelini. After version 0.6.6, this
 * script is maintained by the WazeDev team. Special thanks is definitely given to MajkiiTelini for his
 * hard work and dedication to the original script.
 *

W.model.actionManager._redoStack.length === 0  // Example of checking for an empty undo stack to infer that a save just occurred, which can be used to trigger a refresh of HNs after edits. Not currently implemented in the script but may be useful in the future if a reliable "afterSave" event cannot be found in the SDK.

 */


(function () {
    'use strict';

    let wmeSDK; // WME SDK instance
    let eventHandlers = {}; // Store event handlers for cleanup

    // eslint-disable-next-line no-nested-ternary
    const _SCRIPT_SHORT_NAME = `HN NavPoints${(/beta/.test(GM_info.script.name) ? ' β' : /\(DEV\)/i.test(GM_info.script.name) ? ' Ω' : '')}`,
        _SCRIPT_LONG_NAME = GM_info.script.name,
        _IS_ALPHA_VERSION = /[Ω]/.test(_SCRIPT_SHORT_NAME),
        _IS_BETA_VERSION = /[β]/.test(_SCRIPT_SHORT_NAME),
        _PROD_DL_URL = 'https://greasyfork.org/scripts/390565-wme-hn-navpoints/code/WME%20HN%20NavPoints.user.js',
        _FORUM_URL = 'https://www.waze.com/forum/viewtopic.php?f=819&t=269397',
        _SETTINGS_STORE_NAME = 'WMEHNNavPoints',
        _BETA_DL_URL = 'YUhSMGNITTZMeTluY21WaGMzbG1iM0pyTG05eVp5OXpZM0pwY0hSekx6TTVNRFUzTXkxM2JXVXRhRzR0Ym1GMmNHOXBiblJ6TFdKbGRHRXZZMjlrWlM5WFRVVWxNakJJVGlVeU1FNWhkbEJ2YVc1MGN5VXlNQ2hpWlhSaEtTNTFjMlZ5TG1weg==',
        _ALERT_UPDATE = true,
        _SCRIPT_VERSION = GM_info.script.version.toString(),
        _SCRIPT_VERSION_CHANGES = ['CHANGE: WME beta release v2.242 compatibility.'],
        _DEBUG = /[βΩ]/.test(_SCRIPT_SHORT_NAME),
        _LOAD_BEGIN_TIME = performance.now(),
        _elems = {
            div: document.createElement('div'),
            h4: document.createElement('h4'),
            h6: document.createElement('h6'),
            form: document.createElement('form'),
            i: document.createElement('i'),
            label: document.createElement('label'),
            li: document.createElement('li'),
            p: document.createElement('p'),
            svg: document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
            svgText: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
            ul: document.createElement('ul'),
            'wz-checkbox': document.createElement('wz-checkbox'),
            'wz-text-input': document.createElement('wz-text-input')
        },
        _spinners = {
            destroyAllHNs: false,
            drawHNs: false,
            processSegs: false
        },
        _timeouts = {
            checkMarkersEvents: {},
            hideTooltip: undefined,
            onWmeReady: undefined,
            saveSettingsToStorage: undefined,
            stripTooltipHTML: undefined
        },
        dec = (s = '') => atob(atob(s));

    const _HN_LINES_LAYER = '__HNNavPointsLayer';
    const _HN_NUMBERS_LAYER = '__HNNavPointsNumbersLayer';
    const _HN_LINES_CHECKBOX = 'HN NavPoints';
    const _HN_NUMBERS_CHECKBOX = 'HN NavPoints Numbers';

    // Internal feature tracking Maps (replace OL getFeaturesByAttribute)
    let _allLineFeatures = new Map();    // featureId → [shadowFeature, coloredFeature]
    let _allNumberFeatures = new Map();  // featureId → numberFeature
    let _segmentHnIds = new Map();       // segmentId → Set<featureId>
    let _numberFeatureMeta = new Map();  // 'n-${featureId}' → {segmentId, hnNumber, lon, lat}

    let _settings = {},
        _scriptActive = false,
        _saveButtonObserver,
        _processedSegments = [],
        _segmentsToProcess = [],
        _segmentsToRemove = [],
        _hnNavPointsTooltipDiv,
        _popup = {
            inUse: false,
            hnNumber: -1,
            segmentId: -1
        };

    function log(message, data = '') { console.log(`${_SCRIPT_SHORT_NAME}:`, message, data); }
    function logError(message, data = '') { console.error(`${_SCRIPT_SHORT_NAME}:`, new Error(message), data); }
    // function logWarning(message, data = '') { console.warn(`${_SCRIPT_SHORT_NAME}:`, message, data); }
    function logDebug(message, data = '') {
        if (_DEBUG)
            log(message, data);
    }

    function getMapZoom() {
        if (wmeSDK && wmeSDK.Map) {
            try {
                return wmeSDK.Map.getZoomLevel();
            } catch (err) {
                logDebug('SDK getZoomLevel failed, using W fallback', err);
            }
        }
        if (typeof W !== 'undefined' && W.map && W.map.getOLMap)
            return W.map.getOLMap().getZoom();
        return 0;
    }

    function $extend(...args) {
        const extended = {},
            deep = Object.prototype.toString.call(args[0]) === '[object Boolean]' ? args[0] : false,
            merge = function (obj) {
                Object.keys(obj).forEach((prop) => {
                    if (Object.prototype.hasOwnProperty.call(obj, prop)) {
                        if (deep && Object.prototype.toString.call(obj[prop]) === '[object Object]')
                            extended[prop] = $extend(true, extended[prop], obj[prop]);
                        else if ((obj[prop] !== undefined) && (obj[prop] !== null))
                            extended[prop] = obj[prop];
                    }
                });
            };
        for (let i = deep ? 1 : 0, { length } = args; i < length; i++) {
            if (args[i])
                merge(args[i]);
        }
        return extended;
    }

    function createElem(type = '', attrs = {}, eventListener = []) {
        const el = _elems[type]?.cloneNode(false) || _elems.div.cloneNode(false),
            applyEventListeners = function ([evt, cb]) {
                return this.addEventListener(evt, cb);
            };
        Object.keys(attrs).forEach((attr) => {
            if ((attrs[attr] !== undefined) && (attrs[attr] !== 'undefined') && (attrs[attr] !== null) && (attrs[attr] !== 'null')) {
                if ((attr === 'disabled') || (attr === 'checked') || (attr === 'selected') || (attr === 'textContent') || (attr === 'innerHTML'))
                    el[attr] = attrs[attr];
                else
                    el.setAttribute(attr, attrs[attr]);
            }
        });
        if (eventListener.length > 0) {
            eventListener.forEach((obj) => {
                Object.entries(obj).map(applyEventListeners.bind(el));
            });
        }
        return el;
    }

    async function loadSettingsFromStorage() {
        const defaultSettings = {
                disableBelowZoom: 17,
                enableTooltip: true,
                hnLines: true,
                hnNumbers: true,
                keepHNLayerOnTop: true,
                shortcuts: {},
                lastSaved: 0,
                lastVersion: undefined
            },
            loadedSettings = JSON.parse(localStorage.getItem(_SETTINGS_STORE_NAME));
        _settings = $extend(true, {}, defaultSettings, loadedSettings);
        if (_settings.disableBelowZoom < 11)
            _settings.disableBelowZoom += 12;
        // Migrate legacy shortcut string keys to shortcuts:{} object format
        if (!_settings.shortcuts) _settings.shortcuts = {};
        if (_settings.toggleHNNavPointsShortcut) {
            _settings.shortcuts.toggleHNNavPoints = { raw: _settings.toggleHNNavPointsShortcut, combo: _settings.toggleHNNavPointsShortcut };
            delete _settings.toggleHNNavPointsShortcut;
        }
        if (_settings.toggleHNNavPointsNumbersShortcut) {
            _settings.shortcuts.toggleHNNavPointsNumbers = { raw: _settings.toggleHNNavPointsNumbersShortcut, combo: _settings.toggleHNNavPointsNumbersShortcut };
            delete _settings.toggleHNNavPointsNumbersShortcut;
        }
        _timeouts.saveSettingsToStorage = window.setTimeout(saveSettingsToStorage, 5000);

        return Promise.resolve();
    }

    function saveSettingsToStorage() {
        checkTimeout({ timeout: 'saveSettingsToStorage' });
        if (localStorage) {
            // Persist current shortcut key assignments (only our own shortcuts)
            if (wmeSDK) {
                const _OUR_SHORTCUT_IDS = new Set(['toggleHNNavPoints', 'toggleHNNavPointsNumbers']);
                _settings.shortcuts = {};
                wmeSDK.Shortcuts.getAllShortcuts()
                    .filter((sc) => _OUR_SHORTCUT_IDS.has(sc.shortcutId))
                    .forEach((sc) => {
                        _settings.shortcuts[sc.shortcutId] = { combo: sc.shortcutKeys ?? null };
                    });
            }
            _settings.lastVersion = _SCRIPT_VERSION;
            _settings.lastSaved = Date.now();
            localStorage.setItem(_SETTINGS_STORE_NAME, JSON.stringify(_settings));
            logDebug('Settings saved.');
        }
    }

    function _registerShortcut(shortcutId, description, callback) {
        const savedCombo = _settings.shortcuts?.[shortcutId]?.combo ?? null;
        let shortcutKeys = savedCombo;
        if (shortcutKeys) {
            try {
                if (wmeSDK.Shortcuts.areShortcutKeysInUse({ shortcutKeys })) {
                    logDebug(`Shortcut keys "${shortcutKeys}" already in use; registering "${description}" with no key.`);
                    shortcutKeys = null;
                }
            } catch (_) {
                shortcutKeys = null;
            }
        }
        try {
            wmeSDK.Shortcuts.createShortcut({ shortcutId, shortcutKeys, description, callback });
            logDebug(`Shortcut registered: "${description}" (${shortcutKeys ?? 'none'})`);
        } catch (err) {
            logDebug(`Failed to register shortcut "${description}": ${err.message ?? err}`);
        }
    }
    function showScriptInfoAlert() {
        if (_ALERT_UPDATE && (_SCRIPT_VERSION !== _settings.lastVersion)) {
            const divElemRoot = createElem('div');
            divElemRoot.appendChild(createElem('p', { textContent: 'What\'s New:' }));
            const ulElem = createElem('ul');
            if (_SCRIPT_VERSION_CHANGES.length > 0) {
                for (let idx = 0, { length } = _SCRIPT_VERSION_CHANGES; idx < length; idx++)
                    ulElem.appendChild(createElem('li', { innerHTML: _SCRIPT_VERSION_CHANGES[idx] }));
            }
            else {
                ulElem.appendChild(createElem('li', { textContent: 'Nothing major.' }));
            }
            divElemRoot.appendChild(ulElem);
            // Show custom alert using native alert or try WazeWrap if available
            try {
                WazeWrap.Interface.ShowScriptUpdate(_SCRIPT_SHORT_NAME, _SCRIPT_VERSION, divElemRoot.innerHTML, (_IS_BETA_VERSION ? dec(_BETA_DL_URL) : _PROD_DL_URL).replace(/code\/.*\.js/, ''), _FORUM_URL);
            }
            catch (err) {
                // Fallback to native alert if WazeWrap not available
                logDebug('WazeWrap.Interface not available for update alert', err);
            }
        }
    }

    function checkTimeout(obj) {
        if (obj.toIndex) {
            if (_timeouts[obj.timeout]?.[obj.toIndex]) {
                window.clearTimeout(_timeouts[obj.timeout][obj.toIndex]);
                delete (_timeouts[obj.timeout][obj.toIndex]);
            }
        }
        else {
            if (_timeouts[obj.timeout])
                window.clearTimeout(_timeouts[obj.timeout]);
            _timeouts[obj.timeout] = undefined;
        }
    }

    function doSpinner(spinnerName = '', spin = true) {
        const btn = document.getElementById('hnNPSpinner');
        if (!spin) {
            _spinners[spinnerName] = false;
            if (!Object.values(_spinners).some((a) => a === true)) {
                if (btn) {
                    btn.classList.remove('fa-spin');
                    document.getElementById('divHnNPSpinner').style.display = 'none';
                }
                else {
                    const topBar = document.querySelector('#topbar-container .topbar'),
                        divElem = createElem('div', {
                            id: 'divHnNPSpinner', title: 'WME HN NavPoints is currently processing house numbers.', style: 'font-size:20px;background:white;float:left;display:none;'
                        });
                    divElem.appendChild(createElem('i', { id: 'hnNPSpinner', class: 'fa fa-spinner' }));
                    topBar.insertBefore(divElem, topBar.firstChild);
                }
            }
        }
        else {
            _spinners[spinnerName] = true;
            if (!btn) {
                _spinners[spinnerName] = true;
                const topBar = document.querySelector('#topbar-container .topbar'),
                    divElem = createElem('div', {
                        id: 'divHnNPSpinner', title: 'WME HN NavPoints is currently processing house numbers.', style: 'font-size:20px;background:white;float:left;'
                    });
                divElem.appendChild(createElem('i', { id: 'hnNPSpinner', class: 'fa fa-spinner fa-spin' }));
                topBar.insertBefore(divElem, topBar.firstChild);
            }
            else if (!btn.classList.contains('fa-spin')) {
                btn.classList.add('fa-spin');
                document.getElementById('divHnNPSpinner').style.display = '';
            }
        }
    }

    // eslint-disable-next-line default-param-last
    function processSegmentsToRemove(force = false, segmentsArr) {
        const segmentsToProcess = segmentsArr || _segmentsToRemove;
        let needsRedraw = false;
        if (segmentsToProcess.length > 0) {
            for (let i = segmentsToProcess.length - 1; i > -1; i--) {
                const segId = segmentsToProcess[i];
                const seg = wmeSDK ? wmeSDK.DataModel.Segments.getById({ segmentId: segId }) : null;
                if (!seg || force) {
                    segmentsToProcess.splice(i, 1);
                    const featureIds = _segmentHnIds.get(segId);
                    if (featureIds) {
                        featureIds.forEach((fid) => {
                            _allLineFeatures.delete(fid);
                            _allNumberFeatures.delete(fid);
                            _numberFeatureMeta.delete(`n-${fid}`);
                        });
                        _segmentHnIds.delete(segId);
                        needsRedraw = true;
                    }
                }
            }
            if (needsRedraw)
                _redrawHNLayers();
        }
    }

    async function hnLayerToggled(checked) {
        if (wmeSDK)
            wmeSDK.Map.setLayerVisibility({ layerName: _HN_LINES_LAYER, visibility: checked });
        _settings.hnLines = checked;
        saveSettingsToStorage();
        if (checked) {
            if (!_scriptActive)
                await initBackgroundTasks('enable');
            const allSegments = wmeSDK ? wmeSDK.DataModel.Segments.getAll() : [];
            processSegs('hnLayerToggled', allSegments.filter((o) => o && (typeof o.getAttribute === 'function' ? o.getAttribute('hasHNs') : o.hasHouseNumbers)));
        }
        else if (!_settings.hnNumbers && _scriptActive) {
            initBackgroundTasks('disable');
        }
    }

    async function hnNumbersLayerToggled(checked) {
        if (wmeSDK)
            wmeSDK.Map.setLayerVisibility({ layerName: _HN_NUMBERS_LAYER, visibility: checked });
        _settings.hnNumbers = checked;
        saveSettingsToStorage();
        if (checked) {
            if (!_scriptActive)
                await initBackgroundTasks('enable');
            const allSegments = wmeSDK ? wmeSDK.DataModel.Segments.getAll() : [];
            processSegs('hnNumbersLayerToggled', allSegments.filter((o) => o && (typeof o.getAttribute === 'function' ? o.getAttribute('hasHNs') : o.hasHouseNumbers)));
        }
        else if (!_settings.hnLines && _scriptActive) {
            initBackgroundTasks('disable');
        }
    }



    function removeHNs(objArr) {
        let hasChanges = false;
        const getHNSegmentId = (hn) => (typeof hn.getSegmentId === 'function') ? hn.getSegmentId() : hn.segmentId,
            getHNId = (hn) => (typeof hn.getID === 'function') ? hn.getID() : hn.id;
        objArr.forEach((hnObj) => {
            const featureId = getHNId(hnObj);
            if (_allLineFeatures.has(featureId)) {
                _allLineFeatures.delete(featureId);
                _allNumberFeatures.delete(featureId);
                _numberFeatureMeta.delete(`n-${featureId}`);
                const segmentId = getHNSegmentId(hnObj);
                const segSet = _segmentHnIds.get(segmentId);
                if (segSet) {
                    segSet.delete(featureId);
                    if (segSet.size === 0)
                        _segmentHnIds.delete(segmentId);
                }
                hasChanges = true;
            }
        });
        if (hasChanges)
            _redrawHNLayers();
    }

    function mercatorToWGS84(x, y) {
        return {
            lon: x / 20037508.34 * 180,
            lat: (180 / Math.PI) * (2 * Math.atan(Math.exp(y / 20037508.34 * Math.PI)) - Math.PI / 2)
        };
    }

    function drawHNs(houseNumberArr) {
        if (houseNumberArr.length === 0)
            return;
        doSpinner('drawHNs', true);
        let hasChanges = false;
        // Helper: support both legacy W HNs and SDK HouseNumbers
        const getHNSegmentId = (hn) => (typeof hn.getSegmentId === 'function') ? hn.getSegmentId() : hn.segmentId,
            getHNId = (hn) => (typeof hn.getID === 'function') ? hn.getID() : hn.id,
            getHNNumber = (hn) => (typeof hn.getNumber === 'function') ? hn.getNumber() : hn.number,
            getHNUpdatedBy = (hn) => (typeof hn.getUpdatedBy === 'function') ? hn.getUpdatedBy() : hn.updatedBy,
            getHNIsForced = (hn) => (typeof hn.isForced === 'function') ? hn.isForced() : hn.isForced,
            getHNFractionPoint = (hn) => {
                if (typeof hn.getFractionPoint === 'function') return hn.getFractionPoint(); // legacy
                return hn.fractionPoint; // SDK: Point | null
            },
            getHNGeometry = (hn) => {
                // Legacy: check for getOLGeometry (OpenLayers) then getGeometry
                if (typeof hn.getOLGeometry === 'function') return hn.getOLGeometry();
                if (typeof hn.getGeometry === 'function') return hn.getGeometry();
                return hn.geometry; // SDK: Point with coordinates: [lon, lat]
            };
        for (let i = 0, { length } = houseNumberArr; i < length; i++) {
            const hnObj = houseNumberArr[i],
                segmentId = getHNSegmentId(hnObj);
            const segment = wmeSDK ? wmeSDK.DataModel.Segments.getById({ segmentId }) : null;
            if (segment) {
                hasChanges = true;
                const featureId = getHNId(hnObj);
                // Remove old features for this HN from tracking maps
                _allLineFeatures.delete(featureId);
                _allNumberFeatures.delete(featureId);
                _numberFeatureMeta.delete(`n-${featureId}`);
                // Update segment-to-HN tracking
                if (!_segmentHnIds.has(segmentId))
                    _segmentHnIds.set(segmentId, new Set());
                _segmentHnIds.get(segmentId).add(featureId);
                // Fraction point (p1): convert to WGS84 if needed
                let fractionLon, fractionLat;
                const fractionPoint = getHNFractionPoint(hnObj);
                if (fractionPoint?.coordinates) {
                    [fractionLon, fractionLat] = fractionPoint.coordinates;
                }
                else if (fractionPoint?.x !== undefined && fractionPoint?.y !== undefined) {
                    const fp = mercatorToWGS84(fractionPoint.x, fractionPoint.y);
                    fractionLon = fp.lon;
                    fractionLat = fp.lat;
                }
                else {
                    // Fallback: skip if no fraction point
                    logDebug(`No fraction point for HN ${getHNNumber(hnObj)}`);
                    continue;
                }
                // Geometry point (p2): always EPSG:3857 from OL/legacy geometry
                const geomObj = getHNGeometry(hnObj),
                    rawGeomX = geomObj?.coordinates?.[0] ?? geomObj?.x,
                    rawGeomY = geomObj?.coordinates?.[1] ?? geomObj?.y,
                    gp = (rawGeomX !== undefined && rawGeomY !== undefined) ? mercatorToWGS84(rawGeomX, rawGeomY) : { lon: fractionLon, lat: fractionLat },
                    geomLon = gp.lon,
                    geomLat = gp.lat,
                    strokeColor = (getHNIsForced(hnObj)
                        ? (!getHNUpdatedBy(hnObj)) ? 'red' : 'orange'
                        : (!getHNUpdatedBy(hnObj)) ? 'yellow' : 'white'
                    ),
                    lineCoords = [[fractionLon, fractionLat], [geomLon, geomLat]],
                    numFeatId = `n-${featureId}`;
                const hnText = getHNNumber(hnObj) || '';
                _allLineFeatures.set(featureId, [
                    {
                        type: 'Feature',
                        id: `ls-${featureId}`,
                        geometry: { type: 'LineString', coordinates: lineCoords },
                        properties: { segmentId, featureId, featureType: 'shadow' }
                    },
                    {
                        type: 'Feature',
                        id: `l-${featureId}`,
                        geometry: { type: 'LineString', coordinates: lineCoords },
                        properties: { segmentId, featureId, featureType: 'colored', strokeColor }
                    }
                ]);
                _allNumberFeatures.set(featureId, {
                    type: 'Feature',
                    id: numFeatId,
                    geometry: { type: 'Point', coordinates: [geomLon, geomLat] },
                    properties: { segmentId, featureId, featureType: 'hnNumber', hnNumber: hnText, strokeColor }
                });
                _numberFeatureMeta.set(numFeatId, {
                    segmentId,
                    hnNumber: hnText,
                    lon: geomLon,
                    lat: geomLat
                });
            }
        }
        if (hasChanges)
            _redrawHNLayers();
        doSpinner('drawHNs', false);
    }

    function destroyAllHNs() {
        doSpinner('destroyAllHNs', true);
        if (wmeSDK) {
            wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: _HN_LINES_LAYER });
            wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: _HN_NUMBERS_LAYER });
        }
        _allLineFeatures.clear();
        _allNumberFeatures.clear();
        _segmentHnIds.clear();
        _numberFeatureMeta.clear();
        _processedSegments = [];
        doSpinner('destroyAllHNs', false);
        Promise.resolve();
    }

    function getMapExtentBbox() {
        return wmeSDK ? wmeSDK.Map.getMapExtent() : [0, 0, 0, 0];
    }

    function _redrawHNLayers() {
        if (!wmeSDK) return;
        wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: _HN_LINES_LAYER });
        wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: _HN_NUMBERS_LAYER });
        const allLines = [..._allLineFeatures.values()].flat();
        const allNums = [..._allNumberFeatures.values()];
        if (allLines.length)
            wmeSDK.Map.addFeaturesToLayer({ layerName: _HN_LINES_LAYER, features: allLines });
        if (allNums.length)
            wmeSDK.Map.addFeaturesToLayer({ layerName: _HN_NUMBERS_LAYER, features: allNums });
    }

    function processSegs(action, arrSegObjs, processAll = false, retry = 0) {
    /* As of 2020.06.08 (sometime before this date) updatedOn does not get updated when updating house numbers. Looking for a new
     * way to track which segments have been updated most recently to prevent a total refresh of HNs after an event.
     * Changed to using a global to keep track of segmentIds touched during HN edit mode.
     */
        if ((action === 'settingChanged') && (getMapZoom() < _settings.disableBelowZoom)) {
            destroyAllHNs();
            return;
        }
        if (!arrSegObjs || (arrSegObjs.length === 0) || (getMapZoom() < _settings.disableBelowZoom) || preventProcess())
            return;
        doSpinner('processSegs', true);
        const getSegmentId = (segObj) => (typeof segObj.getID === 'function') ? segObj.getID() : segObj.id,
            getSegmentUpdatedOn = (segObj) => (typeof segObj.getUpdatedOn === 'function') ? segObj.getUpdatedOn() : (segObj.modificationData?.updatedOn ?? 0),
            findObjIndex = (array, fldName, value) => array.map((a) => a[fldName]).indexOf(value),
            processError = (err, chunk) => {
                logDebug(`Retry: ${retry}`);
                if (retry < 5)
                    processSegs(action, chunk, true, ++retry);
                else {
                    // Handle both HTTP errors (err.status/err.responseText) and SDK/Promise rejections (err.message)
                    const errMsg = err.status 
                        ? `Code: ${err.status} - Text: ${err.responseText}`
                        : (err.message ? `${err.message}` : String(err));
                    logError(`Get HNs for ${chunk.length} segments failed. ${errMsg}`);
                }
            },
            processJSON = (jsonData) => {
                // Legacy W.controller.descartesClient returns { segmentHouseNumbers: { objects: [...] } }
                // SDK returns HouseNumber[] directly
                if (jsonData?.segmentHouseNumbers?.objects && jsonData.segmentHouseNumbers.objects.length > 0)
                    drawHNs(jsonData.segmentHouseNumbers.objects);
                else if (Array.isArray(jsonData) && jsonData.length > 0)
                    drawHNs(jsonData);
            },
            mapHouseNumbers = (segObj) => getSegmentId(segObj),
            invokeProcessError = function (err) { return processError(err, this); };
        if ((action === 'objectsremoved')) {
            if (arrSegObjs?.length > 0) {
                const [west, south, east, north] = getMapExtentBbox();
                const extentPoly = turf.bboxPolygon([west, south, east, north]);
                let needsRedraw = false;
                arrSegObjs.forEach((segObj) => {
                    const segmentId = getSegmentId(segObj);
                    if (segmentId > 0) {
                        const segGeom = segObj.geometry;
                        if (!segGeom || !turf.booleanIntersects(extentPoly, { type: 'Feature', geometry: segGeom })) {
                            const featureIds = _segmentHnIds.get(segmentId);
                            if (featureIds) {
                                featureIds.forEach((fid) => {
                                    _allLineFeatures.delete(fid);
                                    _allNumberFeatures.delete(fid);
                                    _numberFeatureMeta.delete(`n-${fid}`);
                                });
                                _segmentHnIds.delete(segmentId);
                                needsRedraw = true;
                            }
                            const segIdx = findObjIndex(_processedSegments, 'segId', segmentId);
                            if (segIdx > -1)
                                _processedSegments.splice(segIdx, 1);
                        }
                    }
                });
                if (needsRedraw)
                    _redrawHNLayers();
            }
        }
        else { // action = 'objectsadded', 'zoomend', 'init', 'exithousenumbers', 'hnLayerToggled', 'hnNumbersLayerToggled', 'settingChanged', 'afterSave', 'afterclearactions'
            let i = arrSegObjs.length;
            while (i--) {
                if (getSegmentId(arrSegObjs[i]) < 0) {
                    arrSegObjs.splice(i, 1);
                }
                else {
                    const segIdx = findObjIndex(_processedSegments, 'segId', getSegmentId(arrSegObjs[i]));
                    if (segIdx > -1) {
                        if (getSegmentUpdatedOn(arrSegObjs[i]) > _processedSegments[segIdx].updatedOn)
                            _processedSegments[segIdx].updatedOn = getSegmentUpdatedOn(arrSegObjs[i]);
                        else if (!processAll)
                            arrSegObjs.splice(i, 1);
                    }
                    else {
                        _processedSegments.push({ segId: getSegmentId(arrSegObjs[i]), updatedOn: getSegmentUpdatedOn(arrSegObjs[i]) });
                    }
                }
            }
            while (arrSegObjs.length > 0) {
                let chunk;
                if (retry === 1)
                    chunk = arrSegObjs.splice(0, 250);
                else if (retry === 2)
                    chunk = arrSegObjs.splice(0, 125);
                else if (retry === 3)
                    chunk = arrSegObjs.splice(0, 100);
                else if (retry === 4)
                    chunk = arrSegObjs.splice(0, 50);
                else
                    chunk = arrSegObjs.splice(0, 500);
                try {
                    if (typeof W !== 'undefined' && W.controller && W.controller.descartesClient && W.controller.descartesClient.getHouseNumbers) {
                        W.controller.descartesClient.getHouseNumbers(chunk.map(mapHouseNumbers))
                            .then(processJSON)
                            .catch((err) => {
                                logDebug('W.controller.descartesClient.getHouseNumbers promise rejected:', err);
                                invokeProcessError.call(chunk, err);
                            });
                    }
                    else if (wmeSDK?.DataModel?.HouseNumbers?.fetchHouseNumbers) {
                        wmeSDK.DataModel.HouseNumbers.fetchHouseNumbers({ segmentIds: chunk.map(mapHouseNumbers) })
                            .then(processJSON)
                            .catch((err) => {
                                logDebug('fetchHouseNumbers promise rejected:', err);
                                invokeProcessError.call(chunk, err);
                            });
                    }
                    else {
                        logError('Neither W.controller.descartesClient nor SDK HouseNumbers API available');
                        processError(new Error('No HouseNumbers API available'), chunk);
                    }
                }
                catch (error) {
                    logDebug('HouseNumbers API call error:', error);
                    processError(error, [...chunk]);
                }
            }
        }
        doSpinner('processSegs', false);
    }

    function preventProcess() {
        if (!_settings.hnLines && !_settings.hnNumbers) {
            if (_scriptActive)
                initBackgroundTasks('disable');
            destroyAllHNs();
            return true;
        }
        if (getMapZoom() < _settings.disableBelowZoom) {
            destroyAllHNs();
            return true;
        }
        return false;
    }

    function segmentsEvent(evt) {
        if (!evt || preventProcess())
            return;
        if ((this.action === 'objectssynced') || (this.action === 'objectsremoved')) {
            processSegmentsToRemove();
            return;
        }
        if (this.action === 'objectschanged-id') {
            const oldSegmentId = evt.oldID,
                newSegmentID = evt.newID;
            const hnIds = _segmentHnIds.get(oldSegmentId);
            if (hnIds) {
                _segmentHnIds.set(newSegmentID, hnIds);
                _segmentHnIds.delete(oldSegmentId);
                hnIds.forEach((fid) => {
                    const lineFeats = _allLineFeatures.get(fid);
                    if (lineFeats) lineFeats.forEach((f) => { f.properties.segmentId = newSegmentID; });
                    const numFeat = _allNumberFeatures.get(fid);
                    if (numFeat) numFeat.properties.segmentId = newSegmentID;
                    const meta = _numberFeatureMeta.get(`n-${fid}`);
                    if (meta) meta.segmentId = newSegmentID;
                });
            }
        }
        else if (this.action === 'objects-state-deleted') {
            evt.forEach((obj) => {
                if (!_segmentsToRemove.includes(obj.getID()))
                    _segmentsToRemove.push(obj.getID());
            });
        }
        else {
            processSegs(this.action, evt.filter((o) => o && (typeof o.getAttribute === 'function' ? o.getAttribute('hasHNs') : o.hasHouseNumbers)));
        }
    }

    function objectsChangedIdHNs(evt) {
        if (!evt || preventProcess())
            return;
        const oldFeatureId = evt.oldID,
            newFeatureId = evt.newID;
        if (_allLineFeatures.has(oldFeatureId)) {
            const lineFeats = _allLineFeatures.get(oldFeatureId);
            lineFeats.forEach((f) => {
                f.properties.featureId = newFeatureId;
                if (f.id === `ls-${oldFeatureId}`) f.id = `ls-${newFeatureId}`;
                else if (f.id === `l-${oldFeatureId}`) f.id = `l-${newFeatureId}`;
            });
            _allLineFeatures.set(newFeatureId, lineFeats);
            _allLineFeatures.delete(oldFeatureId);
        }
        if (_allNumberFeatures.has(oldFeatureId)) {
            const numFeat = _allNumberFeatures.get(oldFeatureId);
            numFeat.properties.featureId = newFeatureId;
            numFeat.id = `n-${newFeatureId}`;
            _allNumberFeatures.set(newFeatureId, numFeat);
            _allNumberFeatures.delete(oldFeatureId);
            const meta = _numberFeatureMeta.get(`n-${oldFeatureId}`);
            if (meta) {
                _numberFeatureMeta.set(`n-${newFeatureId}`, meta);
                _numberFeatureMeta.delete(`n-${oldFeatureId}`);
            }
        }
        _segmentHnIds.forEach((hnIds) => {
            if (hnIds.has(oldFeatureId)) {
                hnIds.delete(oldFeatureId);
                hnIds.add(newFeatureId);
            }
        });
    }

    function objectsChangedHNs(evt) {
        if (!evt || preventProcess())
            return;
        const getHNSegmentId = (hn) => (typeof hn.getSegmentId === 'function') ? hn.getSegmentId() : hn.segmentId;
        if ((evt.length === 1) && getHNSegmentId(evt[0]) && !_segmentsToProcess.includes(getHNSegmentId(evt[0])))
            _segmentsToProcess.push(getHNSegmentId(evt[0]));
    }

    function objectsStateDeletedHNs(evt) {
        if (!evt || preventProcess())
            return;
        const getHNSegmentId = (hn) => (typeof hn.getSegmentId === 'function') ? hn.getSegmentId() : hn.segmentId;
        if ((evt.length === 1) && getHNSegmentId(evt[0]) && !_segmentsToProcess.includes(getHNSegmentId(evt[0])))
            _segmentsToProcess.push(getHNSegmentId(evt[0]));
        removeHNs(evt);
    }

    function zoomEndEvent() {
        if (preventProcess())
            return;
        if ((getMapZoom() < _settings.disableBelowZoom))
            destroyAllHNs();
        if ((getMapZoom() > (_settings.disableBelowZoom - 1)) && (_processedSegments.length === 0)) {
            const allSegments = wmeSDK ? wmeSDK.DataModel.Segments.getAll() : [];
            processSegs('zoomend', allSegments.filter((o) => o && (typeof o.getAttribute === 'function' ? o.getAttribute('hasHNs') : o.hasHouseNumbers)), true);
        }
    }

    function _getHNFromModel(houseNumberId) {
        if (typeof W === 'undefined' || !W.model?.segmentHouseNumbers) return null;
        return W.model.segmentHouseNumbers.getObjectById(houseNumberId)
            ?? W.model.segmentHouseNumbers.getObjectById(parseInt(houseNumberId, 10))
            ?? null;
    }

    function _hnDrawEvent(ev) {
        if (preventProcess()) return;
        const hn = _getHNFromModel(ev.houseNumberId);
        if (hn) drawHNs([hn]);
    }

    function _hnDeleteEvent(ev) {
        if (preventProcess()) return;
        // houseNumberId IS the featureId; try both string and numeric key forms
        const idStr = ev.houseNumberId;
        const idNum = parseInt(idStr, 10);
        const featureId = _allLineFeatures.has(idStr) ? idStr
            : (_allLineFeatures.has(idNum) ? idNum : null);
        if (featureId === null) return;
        const meta = _numberFeatureMeta.get(`n-${featureId}`);
        removeHNs([{ getID: () => featureId, id: featureId, getSegmentId: () => meta?.segmentId ?? null, segmentId: meta?.segmentId ?? null }]);
    }

    function _noEditsEvent() {
        if (preventProcess()) return;
        processSegmentsToRemove(true, [..._segmentsToProcess]);
        const segsToProcess = wmeSDK
            ? _segmentsToProcess.map(id => wmeSDK.DataModel.Segments.getById({ segmentId: id })).filter(Boolean)
            : [];
        processSegs('afterclearactions', segsToProcess, true);
        _segmentsToProcess = [];
    }

    function _afterUndoEvent() {
        if (preventProcess() || _allLineFeatures.size === 0) return;
        // Reconcile tracked HN features against the W model. Any feature whose
        // HN no longer exists (e.g. after undoing an add) is removed from tracking.
        let hasStale = false;
        _allLineFeatures.forEach((_, featureId) => {
            if (!_getHNFromModel(featureId)) {
                _allLineFeatures.delete(featureId);
                _allNumberFeatures.delete(featureId);
                _numberFeatureMeta.delete(`n-${featureId}`);
                _segmentHnIds.forEach((idSet, segId) => {
                    if (idSet.has(featureId)) {
                        idSet.delete(featureId);
                        if (idSet.size === 0) _segmentHnIds.delete(segId);
                    }
                });
                hasStale = true;
            }
        });
        if (hasStale) _redrawHNLayers();
    }

    async function reloadClicked() {
        if (preventProcess() || document.querySelector('wz-button.overlay-button.reload-button').classList.contains('disabled'))
            return;
        await destroyAllHNs();
        const allSegments = wmeSDK ? wmeSDK.DataModel.Segments.getAll() : [];
        processSegs('reload', allSegments.filter((o) => o && (typeof o.getAttribute === 'function' ? o.getAttribute('hasHNs') : o.hasHouseNumbers)));
    }

    function initBackgroundTasks(status) {
        if (status === 'enable') {
            _saveButtonObserver = new MutationObserver((mutationsList) => {
                const redoStackEmpty = typeof W !== 'undefined' && W.model && W.model.actionManager ? (W.model.actionManager._redoStack.length === 0) : true;
                if ((redoStackEmpty)
                    && mutationsList.some((mutation) => ((mutation.attributeName === 'disabled')
                            && (mutation.oldValue === 'true')
                            && (mutation.target.disabled === true)))
                ) {
                    processSegmentsToRemove();
                }
            });
            _saveButtonObserver.observe(document.getElementById('save-button'), {
                childList: false, attributes: true, attributeOldValue: true, characterData: false, characterDataOldValue: false, subtree: false
            });
            _saveButtonObserver.observing = true;
            document.querySelector('wz-button.overlay-button.reload-button')?.addEventListener('click', reloadClicked);
            
            // Register SDK data model event listeners for segments (SDK mandatory)
            if (wmeSDK && wmeSDK.Events) {
                wmeSDK.Events.trackDataModelEvents({ dataModelName: 'segments' });
                eventHandlers.segmentsAdded = (ev) => {
                    if (ev.dataModelName !== 'segments') return;
                    const segs = ev.objectIds.map(id => wmeSDK.DataModel.Segments.getById({ segmentId: id })).filter(Boolean);
                    segmentsEvent.call({ action: 'objectsadded' }, segs);
                };
                eventHandlers.segmentsRemoved = (ev) => {
                    if (ev.dataModelName !== 'segments') return;
                    segmentsEvent.call({ action: 'objectsremoved' }, ev.objectIds.map(id => ({ getID: () => id, geometry: null })));
                };
                eventHandlers.segmentsSynced = (ev) => {
                    if (ev.dataModelName !== 'segments') return;
                    segmentsEvent.call({ action: 'objectssynced' }, []);
                };
                eventHandlers.segmentsStateDeleted = (ev) => {
                    if (ev.dataModelName !== 'segments') return;
                    segmentsEvent.call({ action: 'objects-state-deleted' }, ev.objectIds.map(id => ({ getID: () => id })));
                };
                eventHandlers.segmentsChangedId = (ev) => {
                    if (ev.dataModelName !== 'segments') return;
                    segmentsEvent.call({ action: 'objectschanged-id' }, ev.objectIds);
                };
                wmeSDK.Events.on({ eventName: 'wme-data-model-objects-added', eventHandler: eventHandlers.segmentsAdded });
                wmeSDK.Events.on({ eventName: 'wme-data-model-objects-removed', eventHandler: eventHandlers.segmentsRemoved });
                wmeSDK.Events.on({ eventName: 'wme-data-model-objects-saved', eventHandler: eventHandlers.segmentsSynced });
                wmeSDK.Events.on({ eventName: 'wme-data-model-object-state-deleted', eventHandler: eventHandlers.segmentsStateDeleted });
                wmeSDK.Events.on({ eventName: 'wme-data-model-object-changed-id', eventHandler: eventHandlers.segmentsChangedId });
                // Layer click for tooltip
                eventHandlers.layerFeatureClicked = (clickEvt) => {
                    const meta = _numberFeatureMeta.get(String(clickEvt.featureId));
                    if (meta)
                        showTooltip({ object: { featureId: clickEvt.featureId, ...meta } });
                };
                wmeSDK.Events.on({ eventName: 'wme-layer-feature-clicked', eventHandler: eventHandlers.layerFeatureClicked });
            }
            // Register SDK map events (SDK mandatory for zoom/layer events)
            if (wmeSDK && wmeSDK.Events) {
                wmeSDK.Events.on({ eventName: 'wme-map-zoom-changed', eventHandler: zoomEndEvent });
                // HN mutation events (replace legacy afterActionsEvent)
                wmeSDK.Events.on({ eventName: 'wme-house-number-added', eventHandler: _hnDrawEvent });
                wmeSDK.Events.on({ eventName: 'wme-house-number-updated', eventHandler: _hnDrawEvent });
                wmeSDK.Events.on({ eventName: 'wme-house-number-moved', eventHandler: _hnDrawEvent });
                wmeSDK.Events.on({ eventName: 'wme-house-number-deleted', eventHandler: _hnDeleteEvent });
                wmeSDK.Events.on({ eventName: 'wme-no-edits', eventHandler: _noEditsEvent });
                wmeSDK.Events.on({ eventName: 'wme-after-undo', eventHandler: _afterUndoEvent });
            }
            _scriptActive = true;
        }
        else if (status === 'disable') {
            _saveButtonObserver = undefined;
            document.querySelector('wz-button.overlay-button.reload-button')?.removeEventListener('click', reloadClicked);
            
            // Remove SDK event listeners (SDK mandatory)
            if (wmeSDK && wmeSDK.Events) {
                wmeSDK.Events.stopDataModelEventsTracking({ dataModelName: 'segments' });
                wmeSDK.Events.off({ eventName: 'wme-data-model-objects-added', eventHandler: eventHandlers.segmentsAdded });
                wmeSDK.Events.off({ eventName: 'wme-data-model-objects-removed', eventHandler: eventHandlers.segmentsRemoved });
                wmeSDK.Events.off({ eventName: 'wme-data-model-objects-saved', eventHandler: eventHandlers.segmentsSynced });
                wmeSDK.Events.off({ eventName: 'wme-data-model-object-state-deleted', eventHandler: eventHandlers.segmentsStateDeleted });
                wmeSDK.Events.off({ eventName: 'wme-data-model-object-changed-id', eventHandler: eventHandlers.segmentsChangedId });
                wmeSDK.Events.off({ eventName: 'wme-map-zoom-changed', eventHandler: zoomEndEvent });
                wmeSDK.Events.off({ eventName: 'wme-layer-feature-clicked', eventHandler: eventHandlers.layerFeatureClicked });
                wmeSDK.Events.off({ eventName: 'wme-house-number-added', eventHandler: _hnDrawEvent });
                wmeSDK.Events.off({ eventName: 'wme-house-number-updated', eventHandler: _hnDrawEvent });
                wmeSDK.Events.off({ eventName: 'wme-house-number-moved', eventHandler: _hnDrawEvent });
                wmeSDK.Events.off({ eventName: 'wme-house-number-deleted', eventHandler: _hnDeleteEvent });
                wmeSDK.Events.off({ eventName: 'wme-no-edits', eventHandler: _noEditsEvent });
                wmeSDK.Events.off({ eventName: 'wme-after-undo', eventHandler: _afterUndoEvent });
            }
            _scriptActive = false;
        }
        return Promise.resolve();
    }

    function enterHNEditMode(segment, moveMap) {
        if (segment && wmeSDK) {
            if (moveMap) {
                const coords = segment.geometry?.coordinates;
                if (coords?.length > 0)
                    wmeSDK.Map.setMapCenter({ lonLat: { lon: coords[0][0], lat: coords[0][1] } });
            }
            try {
                const segId = typeof segment.getID === 'function' ? segment.getID() : segment.id;
                wmeSDK.Editing.setSelection({ selection: { ids: [segId], objectType: 'segment' } });
            }
            catch (err) {
                logDebug('SDK Editing.setSelection failed', err);
            }
            document.querySelector('#segment-edit-general .edit-house-numbers')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
    }

    function showTooltip(evt) {
        if ((getMapZoom() < 16) || !_settings.enableTooltip)
            return;
        if (evt?.object?.featureId) {
            checkTooltip();
            let moveMap = false;
            const { segmentId, hnNumber } = evt.object;
            if (_popup.inUse && (_popup.hnNumber === hnNumber) && (_popup.segmentId === segmentId))
                return;
            const segment = wmeSDK ? wmeSDK.DataModel.Segments.getById({ segmentId }) : null,
                street = wmeSDK && segment ? wmeSDK.DataModel.Streets.getById({ streetId: segment.getPrimaryStreetID() }) : null,
                rawPixel = wmeSDK ? wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: evt.object.lon, lat: evt.object.lat } }) : { x: 0, y: 0 },
                popupPixel = { x: rawPixel.x, y: rawPixel.y },
                divElemRoot = createElem('div', {
                    id: 'hnNavPointsTooltipDiv-tooltip',
                    class: 'tippy-box',
                    'data-state': 'hidden',
                    tabindex: '-1',
                    'data-theme': 'light-border',
                    'data-animation': 'fade',
                    role: 'tooltip',
                    'data-placement': 'top',
                    style: 'max-width: 350px; transition-duration:300ms;'
                }),
                invokeEnterHNEditMode = () => enterHNEditMode(segment, moveMap),
                divElemRootDivDiv = createElem('div', { class: 'house-number-marker-tooltip' });
            divElemRootDivDiv.appendChild(createElem('div', { class: 'title', dir: 'auto', textContent: `${hnNumber} ${(street ? street.getName() : '')}` }));
            divElemRootDivDiv.appendChild(createElem('div', {
                id: 'hnNavPointsTooltipDiv-edit', class: 'edit-button fa fa-pencil', style: segment && segment.canEditHouseNumbers ? '' : 'display:none;'
            }, [{ click: invokeEnterHNEditMode }]));
            const divElemRootDiv = createElem('div', {
                id: 'hnNavPointsTooltipDiv-content', class: 'tippy-content', 'data-state': 'hidden', style: 'transition-duration: 300ms;'
            });
            divElemRootDiv.appendChild(divElemRootDivDiv);
            divElemRoot.appendChild(divElemRootDiv);
            divElemRoot.appendChild(createElem('div', {
                id: 'hnNavPointsTooltipDiv-arrow', class: 'tippy-arrow', style: 'position: absolute; left: 0px;'
            }));
            _hnNavPointsTooltipDiv.replaceChildren(divElemRoot);
            popupPixel.origX = popupPixel.x;
            const popupWidthHalf = (_hnNavPointsTooltipDiv.clientWidth / 2);
            let arrowOffset = (popupWidthHalf - 15),
                dataPlacement = 'top';
            popupPixel.x = ((popupPixel.x - popupWidthHalf + 5) > 0) ? (popupPixel.x - popupWidthHalf + 5) : 10;
            if (popupPixel.x === 10)
                arrowOffset = popupPixel.origX - 22;
            if ((popupPixel.x + (popupWidthHalf * 2)) > (wmeSDK ? wmeSDK.Map.getMapViewportElement().clientWidth : 800)) {
                popupPixel.x = (popupPixel.origX - _hnNavPointsTooltipDiv.clientWidth + 8);
                arrowOffset = (_hnNavPointsTooltipDiv.clientWidth - 30);
                moveMap = true;
            }
            if (popupPixel.y - [..._hnNavPointsTooltipDiv.children].reduce((height, elem) => height + elem.getBoundingClientRect().height, 0) < 0) {
                popupPixel.y += 14;
                dataPlacement = 'bottom';
            }
            else {
                popupPixel.y -= ([..._hnNavPointsTooltipDiv.children].reduce((height, elem) => height + elem.getBoundingClientRect().height, 0) + 14);
            }
            _hnNavPointsTooltipDiv.style.transform = `translate(${Math.round(popupPixel.x)}px, ${Math.round(popupPixel.y)}px)`;
            _hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-arrow').style.transform = `translate(${Math.max(0, Math.round(arrowOffset))}px, 0px)`;
            _hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-tooltip').setAttribute('data-placement', dataPlacement);
            _hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-tooltip').setAttribute('data-state', 'visible');
            _hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-content').setAttribute('data-state', 'visible');
            _popup = { segmentId, hNumber: hnNumber, inUse: true };
        }
    }

    function stripTooltipHTML() {
        checkTimeout({ timeout: 'stripTooltipHTML' });
        _hnNavPointsTooltipDiv.replaceChildren();
        _popup = { segmentId: -1, hnNumber: -1, inUse: false };
    }

    function hideTooltip() {
        checkTimeout({ timeout: 'hideTooltip' });
        _hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-content')?.setAttribute('data-state', 'hidden');
        _hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-tooltip')?.setAttribute('data-state', 'hidden');
        _timeouts.stripTooltipHTML = window.setTimeout(stripTooltipHTML, 400);
    }

    function hideTooltipDelay(evt) {
        if (!evt)
            return;
        checkTimeout({ timeout: 'hideTooltip' });
        const parentsArr = evt.toElement?.offsetParent ? [evt.toElement.offsetParent, evt.toElement.offsetParent.offSetParent] : [];
        if (evt.toElement && parentsArr.includes(_hnNavPointsTooltipDiv))
            return;
        _timeouts.hideTooltip = window.setTimeout(hideTooltip, 100, evt);
    }

    function checkTooltip() {
        checkTimeout({ timeout: 'hideTooltip' });
    }

    function checkHnNavpointsVersion() {
        if (_IS_ALPHA_VERSION)
            return;
        let updateMonitor;
        try {
            updateMonitor = new WazeWrap.Alerts.ScriptUpdateMonitor(_SCRIPT_LONG_NAME, _SCRIPT_VERSION, (_IS_BETA_VERSION ? dec(_BETA_DL_URL) : _PROD_DL_URL), GM_xmlhttpRequest);
            updateMonitor.start();
        }
        catch (err) {
            logError('Upgrade version check:', err);
        }
    }

    async function onWazeWrapReady() {
        log('Initializing.');
        checkHnNavpointsVersion();
        const handleCheckboxToggle = function () {
                const settingName = this.id.substring(14);
                // enableTooltip no longer requires layer swap — SDK layer handles both modes
                _settings[settingName] = this.checked;
                saveSettingsToStorage();
                if ((settingName === 'enableTooltip') && (getMapZoom() > (_settings.disableBelowZoom - 1)) && (_settings.hnLines || _settings.hnNumbers)) {
                    const allSegments = wmeSDK ? wmeSDK.DataModel.Segments.getAll() : [];
                    processSegs('settingChanged', allSegments.filter((o) => o && (typeof o.getAttribute === 'function' ? o.getAttribute('hasHNs') : o.hasHouseNumbers)), true, 0);
                }
            },
            handleTextboxChange = function () {
                const newVal = Math.min(22, Math.max(16, +this.value));
                if ((newVal !== _settings.disableBelowZoom) || (+this.value !== newVal)) {
                    if (newVal !== +this.value)
                        this.value = newVal;
                    _settings.disableBelowZoom = newVal;
                    saveSettingsToStorage();
                    if ((getMapZoom() < newVal) && (_settings.hnLines || _settings.hnNumbers))
                        processSegs('settingChanged', null, true, 0);
                    else if (_settings.hnLines || _settings.hnNumbers) {
                        const allSegments = wmeSDK ? wmeSDK.DataModel.Segments.getAll() : [];
                        processSegs('settingChanged', allSegments.filter((o) => o && (typeof o.getAttribute === 'function' ? o.getAttribute('hasHNs') : o.hasHouseNumbers)), true, 0);
                    }
                }
            },
            buildCheckbox = (id = '', textContent = '', checked = true, title = '', disabled = false) => createElem('wz-checkbox', {
                id, title, disabled, checked, textContent
            }, [{ change: handleCheckboxToggle }]),
            buildTextBox = (id = '', label = '', value = '', placeholder = '', maxlength = 0, autocomplete = 'off', title = '', disabled = false) => createElem('wz-text-input', {
                id, label, value, placeholder, maxlength, autocomplete, title, disabled
            }, [{ change: handleTextboxChange }]);
        await loadSettingsFromStorage();

        // Create SDK layers (replace OpenLayers Layer.Vector and Layer.Markers)
        if (wmeSDK) {
            wmeSDK.Map.addLayer({
                layerName: _HN_LINES_LAYER,
                styleRules: [
                    {
                        predicate: (properties) => properties.featureType === 'shadow',
                        style: { strokeWidth: 4, strokeColor: 'black', strokeOpacity: 0.5, strokeDashstyle: 'dash' }
                    },
                    {
                        predicate: (properties) => properties.featureType === 'colored',
                        style: { strokeWidth: 2, strokeColor: '${getStrokeColor}', strokeOpacity: 1, strokeDashstyle: 'dash' }
                    }
                ],
                styleContext: {
                    getStrokeColor: ({ feature }) => feature.properties.strokeColor || 'white'
                }
            });
            wmeSDK.Map.addLayer({
                layerName: _HN_NUMBERS_LAYER,
                styleRules: [
                    {
                        predicate: (properties) => properties.featureType === 'hnNumber',
                        style: {
                            pointRadius: 0,
                            label: '${getHNLabel}',
                            fontSize: '14px',
                            fontFamily: '"Open Sans", "Arial Unicode MS", sans-serif',
                            fontWeight: 'bold',
                            fontColor: 'black',
                            labelOutlineColor: '${getOutlineColor}',
                            labelOutlineWidth: 5,
                            labelAlign: 'cm'
                        }
                    }
                ],
                styleContext: {
                    getHNLabel: ({ feature }) => feature.properties.hnNumber || '',
                    getOutlineColor: ({ feature }) => feature.properties.strokeColor || 'white'
                }
            });
            wmeSDK.Map.setLayerVisibility({ layerName: _HN_LINES_LAYER, visibility: _settings.hnLines });
            wmeSDK.Map.setLayerVisibility({ layerName: _HN_NUMBERS_LAYER, visibility: _settings.hnNumbers });
            wmeSDK.LayerSwitcher.addLayerCheckbox({ name: _HN_LINES_CHECKBOX, isChecked: _settings.hnLines });
            wmeSDK.LayerSwitcher.addLayerCheckbox({ name: _HN_NUMBERS_CHECKBOX, isChecked: _settings.hnNumbers });
            wmeSDK.Events.on({ eventName: 'wme-layer-checkbox-toggled', eventHandler: (evt) => {
                if (evt.name === _HN_LINES_CHECKBOX) hnLayerToggled(evt.checked);
                else if (evt.name === _HN_NUMBERS_CHECKBOX) hnNumbersLayerToggled(evt.checked);
            } });
            wmeSDK.Events.trackLayerEvents({ layerName: _HN_NUMBERS_LAYER });
        }
        window.addEventListener('beforeunload', saveSettingsToStorage, false);

        // Register shortcuts with SDK
        const toggleHNNavPointsCallback = () => hnLayerToggled(!wmeSDK.Map.isLayerVisible({ layerName: _HN_LINES_LAYER }));
        const toggleHNNavPointsNumbersCallback = () => hnNumbersLayerToggled(!wmeSDK.Map.isLayerVisible({ layerName: _HN_NUMBERS_LAYER }));
        
        _registerShortcut('toggleHNNavPoints', 'Toggle HN NavPoints layer', toggleHNNavPointsCallback);
        _registerShortcut('toggleHNNavPointsNumbers', 'Toggle HN NavPoints Numbers layer', toggleHNNavPointsNumbersCallback);

        // Register sidebar tab with SDK
        let tabLabel, tabPane;
        try {
            const result = await wmeSDK.Sidebar.registerScriptTab({
                tabLabel: 'HN-NavPoints',
                tabPane: createElem('div')
            });
            tabLabel = result.tabLabel;
            tabPane = result.tabPane;
        }
        catch (err) {
            logError('Failed to register sidebar tab with SDK', err);
            return;
        }
        
        tabLabel.appendChild(createElem('i', { class: 'w-icon w-icon-location', style: 'font-size:15px;padding-top:4px;' }));
        tabLabel.title = _SCRIPT_SHORT_NAME;
        const docFrags = document.createDocumentFragment();
        docFrags.appendChild(createElem('h4', { style: 'font-weight:bold;', textContent: _SCRIPT_LONG_NAME }));
        docFrags.appendChild(createElem('h6', { style: 'margin-top:0px;', textContent: _SCRIPT_VERSION }));
        let divElemRoot = createElem('div', { class: 'form-group' });
        divElemRoot.appendChild(buildTextBox(
            'HNNavPoints_disableBelowZoom',
            'Disable when zoom level is (<) less than:',
            _settings.disableBelowZoom,
            '',
            2,
            'off',
            'Disable NavPoints and house numbers when zoom level is less than specified number.\r\nMinimum: 16\r\nDefault: 17',
            false
        ));
        divElemRoot.appendChild(buildCheckbox(
            'HNNavPoints_cbenableTooltip',
            'Enable tooltip',
            _settings.enableTooltip,
            'Enable tooltip when mousing over house numbers.\r\nWarning: This may cause performance issues.',
            false
        ));
        divElemRoot.appendChild(buildCheckbox('HNNavPoints_cbkeepHNLayerOnTop', 'Keep HN layer on top', _settings.keepHNLayerOnTop, 'Keep house numbers layer on top of all other layers.', false));
        const formElem = createElem('form', { class: 'attributes-form side-panel-section' });
        formElem.appendChild(divElemRoot);
        docFrags.appendChild(formElem);
        docFrags.appendChild(createElem('label', { class: 'control-label', textContent: 'Color legend' }));
        divElemRoot = createElem('div', { style: 'margin:0 10px 0 10px; width:130px; text-align:center; font-size:12px; background:black; font-weight:600;' });
        divElemRoot.appendChild(createElem('div', {
            style: 'text-shadow:0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white;', textContent: 'Touched'
        }));
        divElemRoot.appendChild(createElem('div', {
            style: 'text-shadow:0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange;',
            textContent: 'Touched forced'
        }));
        divElemRoot.appendChild(createElem('div', {
            style: 'text-shadow:0 0 3px yellow,0 0 3px yellow,0 0 3px yellow, 0 0 3px yellow,0 0 3px yellow,0 0 3px yellow,0 0 3px yellow,0 0 3px yellow,0 0 3px yellow,0 0 3px yellow;',
            textContent: 'Untouched'
        }));
        divElemRoot.appendChild(createElem('div', {
            style: 'text-shadow:0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red;', textContent: 'Untouched forced'
        }));
        docFrags.appendChild(divElemRoot);
        tabPane.appendChild(docFrags);
        tabPane.id = 'sidepanel-hn-navpoints';
        // SDK registerScriptTab returns Promise, so tabPane is already connected
        if (!_hnNavPointsTooltipDiv) {
            _hnNavPointsTooltipDiv = createElem('div', {
                id: 'hnNavPointsTooltipDiv',
                style: 'z-index:9999; visibility:visible; position:absolute; inset: auto auto 0px 0px; margin: 0px; top: 0px; left: 0px;',
                'data-tippy-root': false
            }, [{ mouseenter: checkTooltip }, { mouseleave: hideTooltipDelay }]);
            (wmeSDK ? wmeSDK.Map.getMapViewportElement() : W.map.getEl()[0]).appendChild(_hnNavPointsTooltipDiv);
        }
        await initBackgroundTasks('enable');
        log(`Fully initialized in ${Math.round(performance.now() - _LOAD_BEGIN_TIME)} ms.`);
        showScriptInfoAlert();
        if (_scriptActive)
            processSegs('init', wmeSDK ? wmeSDK.DataModel.Segments.getAll().filter((o) => o && (typeof o.getAttribute === 'function' ? o.getAttribute('hasHNs') : o.hasHouseNumbers)) : []);
        setTimeout(saveSettingsToStorage, 10000);
    }

    function onWmeReady(tries = 1) {
        if (typeof tries === 'object')
            tries = 1;
        checkTimeout({ timeout: 'onWmeReady' });
        if (WazeWrap?.Ready) {
            logDebug('WazeWrap is ready. Proceeding with initialization.');
            onWazeWrapReady();
        }
        else if (tries < 1000) {
            logDebug(`WazeWrap is not in Ready state. Retrying ${tries} of 1000.`);
            _timeouts.onWmeReady = window.setTimeout(onWmeReady, 200, ++tries);
        }
        else {
            logError(new Error('onWmeReady timed out waiting for WazeWrap Ready state.'));
        }
    }

    function onWmeInitialized() {
        if (W.userscripts?.state?.isReady) {
            logDebug('W is ready and already in "wme-ready" state. Proceeding with initialization.');
            onWmeReady(1);
        }
        else {
            logDebug('W is ready, but state is not "wme-ready". Adding event listener.');
            document.addEventListener('wme-ready', onWmeReady, { once: true });
        }
    }

    // SDK Initialization
    (unsafeWindow || window).SDK_INITIALIZED.then(() => {
        logDebug('SDK_INITIALIZED resolved. Initializing WME SDK.');
        try {
            wmeSDK = getWmeSdk({ scriptId: 'wme-hn-navpoints', scriptName: _SCRIPT_LONG_NAME });
            logDebug('WME SDK initialized');
            onWmeReady();
        }
        catch (err) {
            logError('Failed to initialize WME SDK', err);
            logDebug('Falling back to legacy initialization...');
            onWmeInitialized();
        }
    }).catch(err => {
        logError('SDK_INITIALIZED promise rejected, falling back to legacy init', err);
        // Fallback for legacy WME
        if (typeof W !== 'undefined') {
            onWmeInitialized();
        }
    });
}
)();
