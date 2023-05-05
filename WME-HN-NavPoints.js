// ==UserScript==
// @name            WME HN NavPoints (beta)
// @namespace       https://greasyfork.org/users/166843
// @description     Shows navigation points of all house numbers in WME
// @version         2023.05.05.01
// @author          dBsooner
// @grant           GM_xmlhttpRequest
// @connect         greasyfork.org
// @require         https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @license         GPLv3
// @match           http*://*.waze.com/*editor*
// @exclude         http*://*.waze.com/user/editor*
// @contributionURL https://github.com/WazeDev/Thank-The-Authors
// ==/UserScript==

/* global _, GM_info, GM_xmlhttpRequest, OpenLayers, W, WazeWrap */

/*
 * Original concept and code for WME HN NavPoints was written by MajkiiTelini. After version 0.6.6, this
 * script is maintained by the WazeDev team. Special thanks is definitely given to MajkiiTelini for his
 * hard work and dedication to the original script.
 *
 */

(function () {
    'use strict';

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
        _SCRIPT_VERSION_CHANGES = ['Reverted to 100% vanilla JavaScript, removing reliance on jQuery.',
            'CHANGE: Switch to WazeWrap for script update checking.'
        ],
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
            checkMarkersEvents: undefined,
            hideTooltip: undefined,
            onWmeReady: undefined,
            saveSettingsToStorage: undefined,
            setMarkersEvents: undefined,
            stripTooltipHTML: undefined
        },
        _holdFeatures = {
            hn: [],
            lines: []
        },
        dec = (s = '') => atob(atob(s));

    let _settings = {},
        _scriptActive = false,
        _HNLayerObserver,
        _saveButtonObserver,
        _wmeHnLayer,
        _processedSegments = [],
        _segmentsToProcess = [],
        _segmentsToRemove = [],
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
        const el = _elems[type]?.cloneNode(false) || _elems.div.cloneNode(false);
        Object.keys(attrs).forEach((attr) => {
            if ((attr === 'disabled') || (attr === 'checked') || (attr === 'selected') || (attr === 'textContent') || (attr === 'innerHTML'))
                el[attr] = attrs[attr];
            else
                el.setAttribute(attr, attrs[attr]);
        });
        if (eventListener.length > 0) {
            eventListener.forEach((obj) => {
                Object.entries(obj).map(([evt, cb]) => el.addEventListener(evt, cb));
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
                toggleHNNavPointsShortcut: '',
                toggleHNNavPointsNumbersShortcut: '',
                lastSaved: 0,
                lastVersion: undefined
            },
            loadedSettings = JSON.parse(localStorage.getItem(_SETTINGS_STORE_NAME));
        _settings = $extend(true, {}, defaultSettings, loadedSettings);
        const serverSettings = await WazeWrap.Remote.RetrieveSettings(_SETTINGS_STORE_NAME);
        if (serverSettings?.lastSaved > _settings.lastSaved)
            _settings = $extend(true, _settings, serverSettings);
        if (_settings.disableBelowZoom < 11)
            _settings.disableBelowZoom += 12;
        _timeouts.saveSettingsToStorage = window.setTimeout(saveSettingsToStorage, 5000);

        return Promise.resolve();
    }

    function saveSettingsToStorage() {
        checkTimeout({ timeout: 'saveSettingsToStorage' });
        if (localStorage) {
            _settings.lastVersion = _SCRIPT_VERSION;
            _settings.lastSaved = Date.now();
            localStorage.setItem(_SETTINGS_STORE_NAME, JSON.stringify(_settings));
            WazeWrap.Remote.SaveSettings(_SETTINGS_STORE_NAME, _settings);
            logDebug('Settings saved.');
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
            WazeWrap.Interface.ShowScriptUpdate(_SCRIPT_SHORT_NAME, _SCRIPT_VERSION, divElemRoot.innerHTML, (_IS_BETA_VERSION ? dec(_BETA_DL_URL) : _PROD_DL_URL).replace(/code\/.*\.js/, ''), _FORUM_URL);
        }
    }

    function checkShortcutsChanged() {
        let triggerSave = false;
        ['toggleHNNavPointsShortcut', 'toggleHNNavPointsNumbersShortcut'].forEach((k) => {
            let keys = '';
            const { shortcut } = W.accelerators.Actions[k];
            if (shortcut) {
                if (shortcut.altKey)
                    keys += 'A';
                if (shortcut.shiftKey)
                    keys += 'S';
                if (shortcut.ctrlKey)
                    keys += 'C';
                if (keys !== '')
                    keys += '+';
                if (shortcut.keyCode)
                    keys += shortcut.keyCode;
            }
            else {
                keys = '';
            }
            if (_settings[k] !== keys) {
                _settings[k] = keys;
                triggerSave = true;
            }
        });
        if (triggerSave)
            saveSettingsToStorage();
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

    function processSegmentsToRemove(force = false) {
        if (_segmentsToRemove.length > 0) {
            const hnNavPointsLayer = W.map.getLayerByName('HN NavPoints Layer'),
                hnNavPointsNumbersLayer = W.map.getLayerByName('HN NavPoints Numbers Layer'),
                linesToRemove = [],
                hnsToRemove = [],
                filterMarkers = function (marker) { return marker.segmentId === this; },
                processFilterMarkers = (marker) => hnsToRemove.push(marker);
            for (let i = _segmentsToRemove.length - 1; i > -1; i--) {
                const segId = _segmentsToRemove[i];
                if (!W.model.segments.objects[segId] || force) {
                    _segmentsToRemove.splice(i, 1);
                    linesToRemove.push(hnNavPointsLayer.getFeaturesByAttribute('segmentId', segId));
                    if (!_settings.enableTooltip)
                        hnsToRemove.push(hnNavPointsNumbersLayer.getFeaturesByAttribute('segmentId', segId));
                    else
                        hnNavPointsNumbersLayer.markers.filter(filterMarkers.bind(segId)).forEach(processFilterMarkers);
                }
            }
            if (linesToRemove.length > 0)
                hnNavPointsLayer.removeFeatures(linesToRemove);
            if (hnsToRemove.length > 0) {
                if (!_settings.enableTooltip)
                    hnNavPointsNumbersLayer.removeFeatures(hnsToRemove);
                else
                    hnsToRemove.forEach((marker) => hnNavPointsNumbersLayer.removeMarker(marker));
            }
        }
    }

    async function hnLayerToggled(checked) {
        const hnNavPointsLayer = W.map.getLayerByName('HN NavPoints Layer');
        hnNavPointsLayer.setVisibility(checked);
        _settings.hnLines = checked;
        saveSettingsToStorage();
        if (checked) {
            if (!_scriptActive)
                await initBackgroundTasks('enable');
            processSegs('hnLayerToggled', W.model.segments.getByAttributes({ hasHNs: true }));
        }
        else if (!_settings.hnNumbers && _scriptActive) {
            initBackgroundTasks('disable');
        }
    }

    async function hnNumbersLayerToggled(checked) {
        const hnNavPointsNumbersLayer = W.map.getLayerByName('HN NavPoints Numbers Layer');
        hnNavPointsNumbersLayer.setVisibility(checked);
        _settings.hnNumbers = checked;
        saveSettingsToStorage();
        if (checked) {
            if (!_scriptActive)
                await initBackgroundTasks('enable');
            processSegs('hnNumbersLayerToggled', W.model.segments.getByAttributes({ hasHNs: true }));
        }
        else if (!_settings.hnLines && _scriptActive) {
            initBackgroundTasks('disable');
        }
    }

    function observeHNLayer() {
        if (W.editingMediator.attributes.editingHouseNumbers && !_HNLayerObserver.observing) {
            [_wmeHnLayer] = W.map.getLayersByName('houseNumberMarkers');
            _HNLayerObserver.observe(_wmeHnLayer.div, {
                childList: false, subtree: true, attributes: true, attributeOldValue: true
            });
            _HNLayerObserver.observing = true;
        }
        else if (_HNLayerObserver.observing) {
            _HNLayerObserver.disconnect();
            _HNLayerObserver.observing = false;
        }
        if (!_HNLayerObserver.observing) {
            W.model.segmentHouseNumbers.clear();
            const holdSegmentsToRemove = [..._segmentsToRemove];
            _segmentsToRemove = _segmentsToRemove.concat([..._segmentsToProcess]);
            processSegmentsToRemove(true);
            _segmentsToRemove = [...holdSegmentsToRemove];
            processSegs('exithousenumbers', W.model.segments.getByIds(_segmentsToProcess), true);
            _wmeHnLayer = undefined;
        }
        else {
            _segmentsToProcess = W.selectionManager.getSegmentSelection().segments.map((segment) => segment.attributes.id);
            _segmentsToRemove = [];
        }
        _saveButtonObserver.disconnect();
        _saveButtonObserver.observe(document.querySelector('#toolbar .js-save-popover-target'), {
            childList: false, attributes: true, attributeOldValue: true, characterData: false, characterDataOldValue: false, subtree: false
        });
    }

    function flushHeldFeatures() {
        if (_holdFeatures.hn.length === 0)
            return;
        const hnNavPointsLayer = W.map.getLayerByName('HN NavPoints Layer'),
            hnNavPointsNumbersLayer = W.map.getLayerByName('HN NavPoints Numbers Layer');
        if (hnNavPointsLayer.getFeaturesByAttribute('featureId', _holdFeatures.hn[0].attributes.featureId).length === 0) {
            if (_settings.enableTooltip)
                hnNavPointsNumbersLayer.addMarker(_holdFeatures.hn);
            else
                hnNavPointsNumbersLayer.addFeatures(_holdFeatures.hn);
            hnNavPointsLayer.addFeatures(_holdFeatures.lines);
        }
        _holdFeatures.hn = [];
        _holdFeatures.lines = [];
    }

    function removeHNs(objArr, holdFeatures = false) {
        const linesToRemove = [],
            hnsToRemove = [],
            hnNavPointsLayer = W.map.getLayerByName('HN NavPoints Layer'),
            hnNavPointsNumbersLayer = W.map.getLayerByName('HN NavPoints Numbers Layer'),
            filterMarkers = function (a) { return a.featureId === this.attributes.id; },
            processFilterMarkers = (marker) => {
                if (holdFeatures)
                    _holdFeatures.hn = marker;
                hnsToRemove.push(marker);
            };
        if (_holdFeatures.hn.length > 0)
            flushHeldFeatures();
        objArr.forEach((hnObj) => {
            linesToRemove.push(hnNavPointsLayer.getFeaturesByAttribute('featureId', hnObj.attributes.id));
            if (holdFeatures)
                _holdFeatures.lines = hnNavPointsLayer.getFeaturesByAttribute('featureId', hnObj.attributes.id);
            if (!_settings.enableTooltip) {
                hnsToRemove.push(hnNavPointsNumbersLayer.getFeaturesByAttribute('featureId', hnObj.attributes.id));
                if (holdFeatures)
                    _holdFeatures.hn = hnNavPointsNumbersLayer.getFeaturesByAttribute('featureId', hnObj.attributes.id);
            }
            else {
                hnNavPointsNumbersLayer.markers.filter(filterMarkers.bind(hnObj)).forEach(processFilterMarkers);
            }
        });
        if (linesToRemove.length > 0)
            hnNavPointsLayer.removeFeatures(linesToRemove);
        if (hnsToRemove.length > 0) {
            if (!_settings.enableTooltip)
                hnNavPointsNumbersLayer.removeFeatures(hnsToRemove);
            else
                hnsToRemove.forEach((marker) => hnNavPointsNumbersLayer.removeMarker(marker));
        }
    }

    function drawHNs(houseNumberArr) {
        if (houseNumberArr.length === 0)
            return;
        doSpinner('drawHNs', true);
        let svg,
            svgText;
        const lineFeatures = [],
            linesToRemove = [],
            hnsToRemove = [],
            numberFeatures = [],
            invokeTooltip = _settings.enableTooltip ? (evt) => { showTooltip(evt); } : undefined,
            mapFeatureId = (marker) => marker.featureId,
            hnNavPointsLayer = W.map.getLayerByName('HN NavPoints Layer'),
            hnNavPointsNumbersLayer = W.map.getLayerByName('HN NavPoints Numbers Layer');
        if (_settings.enableTooltip) {
            svg = createElem('svg', { xlink: 'http://www.w3.org/1999/xlink', xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 40 14' });
            svgText = createElem('svgText', { 'text-anchor': 'middle', x: '20', y: '10' });
        }
        for (let i = 0; i < houseNumberArr.length; i++) {
            const hnObj = houseNumberArr[i],
                segmentId = hnObj.getSegmentId(),
                seg = W.model.segments.objects[segmentId];
            if (seg) {
                const featureId = hnObj.getID(),
                    markerIdx = _settings.enableTooltip ? hnNavPointsNumbersLayer.markers.map(mapFeatureId).indexOf(featureId) : undefined,
                    // eslint-disable-next-line no-nested-ternary
                    hnToRemove = _settings.enableTooltip ? (markerIdx > -1) ? hnNavPointsNumbersLayer.markers[markerIdx] : [] : hnNavPointsNumbersLayer.getFeaturesByAttribute('featureId', featureId),
                    rtlChar = /[\u0590-\u083F]|[\u08A0-\u08FF]|[\uFB1D-\uFDFF]|[\uFE70-\uFEFF]/mg,
                    textDir = (hnObj.getNumber().match(rtlChar) !== null) ? 'rtl' : 'ltr';
                linesToRemove.push(hnNavPointsLayer.getFeaturesByAttribute('featureId', featureId));
                if (hnToRemove.length > 0) {
                    if (_settings.enableTooltip)
                        hnsToRemove.push(hnToRemove);
                    else
                        hnsToRemove.push(hnNavPointsNumbersLayer.getFeaturesByAttribute('featureId', featureId));
                }
                const p1 = new OpenLayers.Geometry.Point(hnObj.getFractionPoint().x, hnObj.getFractionPoint().y),
                    p2 = new OpenLayers.Geometry.Point(hnObj.getGeometry().x, hnObj.getGeometry().y),
                    // eslint-disable-next-line no-nested-ternary
                    strokeColor = (hnObj.isForced()
                        ? (!hnObj.getUpdatedBy()) ? 'red' : 'orange'
                        : (!hnObj.getUpdatedBy()) ? 'yellow' : 'white'
                    );
                let lineString = new OpenLayers.Geometry.LineString([p1, p2]),
                    lineFeature = new OpenLayers.Feature.Vector(
                        lineString,
                        { segmentId, featureId },
                        {
                            strokeWidth: 4, strokeColor: 'black', strokeOpacity: 0.5, strokeDashstyle: 'dash', strokeDashArray: '8, 8'
                        }
                    );
                lineFeatures.push(lineFeature);
                lineString = new OpenLayers.Geometry.LineString([p1, p2]);
                lineFeature = new OpenLayers.Feature.Vector(
                    lineString,
                    { segmentId, featureId },
                    {
                        strokeWidth: 2, strokeColor, strokeOpacity: 1, strokeDashstyle: 'dash', strokeDashArray: '8, 8'
                    }
                );
                lineFeatures.push(lineFeature);
                if (_settings.enableTooltip) {
                    svg.setAttribute('style', `text-shadow:0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor};font-size:14px;font-weight:bold;font-family:"Open Sans", "Arial Unicode MS", "sans-serif";direction:${textDir}`);
                    svgText.textContent = hnObj.getNumber();
                    svg.replaceChildren(svgText);
                    const svgIcon = new WazeWrap.Require.Icon(`data:image/svg+xml,${svg.outerHTML}`, { w: 40, h: 18 }),
                        markerFeature = new OpenLayers.Marker(new OpenLayers.LonLat(p2.x, p2.y), svgIcon);
                    markerFeature.events.register('mouseover', null, invokeTooltip);
                    markerFeature.events.register('mouseout', null, hideTooltipDelay);
                    markerFeature.featureId = featureId;
                    markerFeature.segmentId = segmentId;
                    markerFeature.hnNumber = hnObj.getNumber() || '';
                    numberFeatures.push(markerFeature);
                }
                else {
                // eslint-disable-next-line new-cap
                    numberFeatures.push(new OpenLayers.Feature.Vector(new OpenLayers.Geometry.Polygon.createRegularPolygon(p2, 1, 20), {
                        segmentId, featureId, hNumber: hnObj.getNumber(), strokeWidth: 3, Color: strokeColor, textDir
                    }));
                }
                if ((_holdFeatures.hn.length > 0) && (_holdFeatures.hn.map((a) => a.attributes.featureId).indexOf(featureId) > -1)) {
                    _holdFeatures.hn = [];
                    _holdFeatures.lines = [];
                }
            }
        }
        if (lineFeatures.length > 0)
            hnNavPointsLayer.addFeatures(lineFeatures);
        if (numberFeatures.length > 0) {
            if (!_settings.enableTooltip)
                hnNavPointsNumbersLayer.addFeatures(numberFeatures);
            else
                numberFeatures.forEach((marker) => hnNavPointsNumbersLayer.addMarker(marker));
        }
        doSpinner('drawHNs', false);
    }

    function destroyAllHNs() {
        doSpinner('destroyAllHNs', true);
        const hnNavPointsLayer = W.map.getLayerByName('HN NavPoints Layer'),
            hnNavPointsNumbersLayer = W.map.getLayerByName('HN NavPoints Numbers Layer');
        hnNavPointsLayer.destroyFeatures();
        if (_settings.enableTooltip)
            hnNavPointsNumbersLayer.clearMarkers();
        else
            hnNavPointsNumbersLayer.destroyFeatures();
        _processedSegments = [];
        doSpinner('destroyAllHNs', false);
        Promise.resolve();
    }

    function processSegs(action, arrSegObjs, processAll = false, retry = 0) {
    /* As of 2020.06.08 (sometime before this date) updatedOn does not get updated when updating house numbers. Looking for a new
     * way to track which segments have been updated most recently to prevent a total refresh of HNs after an event.
     * Changed to using a global to keep track of segmentIds touched during HN edit mode.
     */
        if ((action === 'settingChanged') && (W.map.getZoom() < _settings.disableBelowZoom)) {
            destroyAllHNs();
            return;
        }
        if (!arrSegObjs || (arrSegObjs.length === 0) || (W.map.getZoom() < _settings.disableBelowZoom) || preventProcess())
            return;
        doSpinner('processSegs', true);
        const eg = W.map.getExtent().toGeometry(),
            findObjIndex = (array, fldName, value) => array.map((a) => a[fldName]).indexOf(value),
            processError = (err, chunk) => {
                logDebug(`Retry: ${retry}`);
                if (retry < 5)
                    processSegs(action, chunk, true, ++retry);
                else
                    logError(`Get HNs for ${chunk.length} segments failed. Code: ${err.status} - Text: ${err.responseText}`);
            },
            processJSON = (jsonData) => {
                if ((jsonData?.error === undefined) && (typeof jsonData?.segmentHouseNumbers?.objects !== 'undefined'))
                    drawHNs(jsonData.segmentHouseNumbers.objects);
            },
            mapHouseNumbers = (segObj) => segObj.getID(),
            invokeProcessError = function (err) { processError(err, this); };
        if ((action === 'objectsremoved')) {
            if (arrSegObjs?.length > 0) {
                const removedSegIds = [],
                    hnNavPointsLayer = W.map.getLayerByName('HN NavPoints Layer'),
                    hnNavPointsNumbersLayer = W.map.getLayerByName('HN NavPoints Numbers Layer'),
                    hnNavPointsToRemove = [],
                    hnNavPointsNumbersToRemove = [];
                arrSegObjs.forEach((segObj) => {
                    const segmentId = segObj.getID();
                    if (!eg.intersects(segObj.geometry) && (segmentId > 0)) {
                        hnNavPointsToRemove.push(hnNavPointsLayer.getFeaturesByAttribute('segmentId', segmentId));
                        if (!_settings.enableTooltip)
                            hnNavPointsNumbersToRemove.push(hnNavPointsNumbersLayer.getFeaturesByAttribute('segmentId', segmentId));
                        else
                            removedSegIds.push(segmentId);
                        const segIdx = findObjIndex(_processedSegments, 'segId', segmentId);
                        if (segIdx > -1)
                            _processedSegments.splice(segIdx, 1);
                    }
                });
                if (hnNavPointsToRemove.length > 0)
                    hnNavPointsLayer.removeFeatures(hnNavPointsToRemove);
                if (hnNavPointsNumbersToRemove.length > 0)
                    hnNavPointsNumbersLayer.removeFeatures(hnNavPointsNumbersToRemove);
                if (removedSegIds.length > 0) {
                    hnNavPointsNumbersLayer.markers.filter((marker) => removedSegIds.includes(marker.segmentId)).forEach((marker) => {
                        hnNavPointsNumbersLayer.removeMarker(marker);
                    });
                }
            }
        }
        else { // action = 'objectsadded', 'zoomend', 'init', 'exithousenumbers', 'hnLayerToggled', 'hnNumbersLayerToggled', 'settingChanged', 'afterSave'
            let i = arrSegObjs.length;
            while (i--) {
                if (arrSegObjs[i].getID() < 0) {
                    arrSegObjs.splice(i, 1);
                }
                else {
                    const segIdx = findObjIndex(_processedSegments, 'segId', arrSegObjs[i].getID());
                    if (segIdx > -1) {
                        if (arrSegObjs[i].getUpdatedOn() > _processedSegments[segIdx].updatedOn)
                            _processedSegments[segIdx].updatedOn = arrSegObjs[i].getUpdatedOn();
                        else if (!processAll)
                            arrSegObjs.splice(i, 1);
                    }
                    else {
                        _processedSegments.push({ segId: arrSegObjs[i].getID(), updatedOn: arrSegObjs[i].getUpdatedOn() });
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
                    W.controller.descartesClient.getHouseNumbers(chunk.map(mapHouseNumbers)).then(processJSON).catch(invokeProcessError.bind(chunk));
                }
                catch (error) {
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
        if (W.map.getZoom() < _settings.disableBelowZoom) {
            destroyAllHNs();
            return true;
        }
        return false;
    }

    function markerEvent(evt) {
        if (!evt || preventProcess())
            return;
        if (evt.type === 'click:input') {
            if (!evt?.object?.dragging?.last)
                removeHNs([evt.object.model], true);
        }
        else if (evt.type === 'delete') {
            removeHNs([evt.object.model]);
        }
        else if (evt.type === 'mousedown') {
            if (evt.target.classList.contains('drag-handle') && this?.model)
                removeHNs([this.model], true);
        }
        else if (evt.type === 'mouseup') {
            if (evt.target.classList.contains('drag-handle') && (_holdFeatures.hn.length > 0))
                flushHeldFeatures();
        }
    }

    function setMarkersEvents(reclick = false, targetNode = undefined) {
        if (W.editingMediator.attributes.editingHouseNumbers) {
            checkTimeout({ timeout: 'setMarkersEvents' });
            hideTooltip();
            if (!_wmeHnLayer || (_wmeHnLayer?.markers?.length === 0)) {
                _timeouts.setMarkersEvents = window.setTimeout(setMarkersEvents, 50, reclick, targetNode);
                return;
            }
            _wmeHnLayer.markers.forEach((marker) => {
                if (!marker.events.listeners['click:input'].some((cbFunc) => cbFunc.func === markerEvent))
                    marker.events.register('click:input', null, markerEvent);
                if (!marker.events.listeners.delete.some((cbFunc) => cbFunc.func === markerEvent))
                    marker.events.register('delete', null, markerEvent);
                const dragHandle = marker.icon.div.children[0].querySelector('.drag-handle');
                if (!dragHandle?.dataset.hnnpHasListeners) {
                    dragHandle.addEventListener('mousedown', markerEvent.bind(marker));
                    dragHandle.addEventListener('mouseup', markerEvent.bind(marker));
                    dragHandle.dataset.hnnpHasListeners = true;
                }
            });
            if (reclick) {
                const tmpNode = targetNode?.querySelector('input.number');
                tmpNode?.focus();
                tmpNode.setSelectionRange(tmpNode.selectionStart, tmpNode.selectionStart);
            }
        }
        else if (_wmeHnLayer) {
            _wmeHnLayer.markers.forEach((marker) => {
                marker.events.unregister('click:input', null, markerEvent);
                marker.events.unregister('delete', null, markerEvent);
            });
        }
    }

    // eslint-disable-next-line default-param-last
    function checkMarkersEvents(retry = false, tries = 0, reclick, targetNode) {
        checkTimeout({ timeout: 'checkMarkersEvents' });
        if (_wmeHnLayer?.markers?.length > 0) {
            if (!_wmeHnLayer.markers[0].events.listeners['click:input'].some((callbackFn) => callbackFn.func === markerEvent))
                setMarkersEvents(reclick, targetNode);
        }
        else if (retry && (tries < 50)) {
            _timeouts.checkMarkersEvents = window.setTimeout(checkMarkersEvents, 100, true, ++tries, reclick, targetNode);
        }
        else if (retry) {
            logError('Timeout (5 sec) exceeded waiting for markers to popuplate within checkMarkersEvents');
        }
    }

    function segmentsEvent(evt) {
        if (!evt || preventProcess())
            return;
        if ((this.action === 'objectssynced') || (this.action === 'objectsremoved'))
            processSegmentsToRemove();
        if (this.action === 'objectschanged-id') {
            const oldSegmentId = evt.oldID,
                newSegmentID = evt.newID,
                hnNavPointsLayer = W.map.getLayerByName('HN NavPoints Numbers Layer'),
                hnNavPointsNumbersLayer = W.map.getLayerByName('HN NavPoints Numbers Layer');
            hnNavPointsLayer.getFeaturesByAttribute('segmentId', oldSegmentId).forEach((feature) => { feature.attributes.segmentId = newSegmentID; });
            if (_settings.enableTooltip)
                hnNavPointsNumbersLayer.markers.filter((marker) => marker.segmentId === oldSegmentId).forEach((marker) => { marker.segmentId = newSegmentID; });
            else
                hnNavPointsNumbersLayer.getFeaturesByAttribute('segmentId', oldSegmentId).forEach((feature) => { feature.attributes.segmentId = newSegmentID; });
        }
        else if (this.action === 'objects-state-deleted') {
            evt.forEach((obj) => {
                if (_segmentsToRemove.indexOf(obj.getID()) === -1)
                    _segmentsToRemove.push(obj.getID());
            });
        }
        else {
            processSegs(this.action, evt.filter((seg) => seg.attributes.hasHNs));
        }
    }

    function objectsChangedIdHNs(evt) {
        if (!evt || preventProcess())
            return;
        const oldFeatureId = evt.oldID,
            newFeatureId = evt.newID,
            hnNavPointsLayer = W.map.getLayerByName('HN NavPoints Layer'),
            hnNavPointsNumbersLayer = W.map.getLayerByName('HN NavPoints Numbers Layer');
        hnNavPointsLayer.getFeaturesByAttribute('featureId', oldFeatureId).forEach((feature) => { feature.attributes.featureId = newFeatureId; });
        if (_settings.enableTooltip)
            hnNavPointsNumbersLayer.markers.filter((marker) => marker.featureId === oldFeatureId).forEach((marker) => { marker.featureId = newFeatureId; });
        else
            hnNavPointsNumbersLayer.getFeaturesByAttribute('featureId', oldFeatureId).forEach((feature) => { feature.attributes.featureId = newFeatureId; });
    }

    function objectsChangedHNs(evt) {
        if (!evt || preventProcess())
            return;
        if ((evt.length === 1) && evt[0].getSegmentId() && (_segmentsToProcess.indexOf(evt[0].getSegmentId()) === -1))
            _segmentsToProcess.push(evt[0].getSegmentId());
        checkMarkersEvents();
    }

    function objectsStateDeletedHNs(evt) {
        if (!evt || preventProcess())
            return;
        if ((evt.length === 1) && evt[0].getSegmentId() && (_segmentsToProcess.indexOf(evt[0].getSegmentId()) === -1))
            _segmentsToProcess.push(evt[0].getSegmentId());
        removeHNs(evt);
        checkMarkersEvents();
    }

    function objectsAddedHNs(evt) {
        if (!evt || preventProcess())
            return;
        if ((evt.length === 1) && evt[0].getSegmentId() && (_segmentsToProcess.indexOf(evt[0].getSegmentId()) === -1))
            _segmentsToProcess.push(evt[0].getSegmentId());
        checkMarkersEvents(true, 0);
    }

    function zoomEndEvent() {
        if (preventProcess())
            return;
        if ((W.map.getZoom() < _settings.disableBelowZoom))
            destroyAllHNs();
        if ((W.map.getZoom() > (_settings.disableBelowZoom - 1)) && (_processedSegments.length === 0))
            processSegs('zoomend', W.model.segments.getByAttributes({ hasHNs: true }), true);
    }

    function afterActionsEvent(evt) {
        if (!evt || preventProcess())
            return;
        if ((evt.type === 'afterclearactions') || (evt.type === 'noActions')) {
            processSegmentsToRemove();
        }
        else if (evt.action?._description?.indexOf('Deleted house number') > -1) {
            if (evt.type === 'afterundoaction')
                drawHNs([evt.action.object]);
            else
                removeHNs([evt.action.object]);
            setMarkersEvents();
        }
        else if (evt.action?._description?.indexOf('Updated house number') > -1) {
            const tempEvt = _.cloneDeep(evt);
            if (evt.type === 'afterundoaction') {
                if (tempEvt.action.newAttributes?.number)
                    tempEvt.action.attributes.number = tempEvt.action.newAttributes.number;
            }
            else if (evt.type === 'afteraction') {
                if (tempEvt.action.oldAttributes?.number)
                    tempEvt.action.attributes.number = tempEvt.action.oldAttributes.number;
            }
            removeHNs([tempEvt.action.object]);
            drawHNs([evt.action.object]);
            setMarkersEvents();
        }
        else if (evt.action?._description?.indexOf('Added house number') > -1) {
            if (evt.type === 'afterundoaction')
                removeHNs([evt.action.houseNumber]);
            else
                drawHNs([evt.action.houseNumber]);
        }
        else if (evt.action?._description?.indexOf('Moved house number') > -1) {
            drawHNs([evt.action.newHouseNumber]);
        }
        else if (evt.action?.houseNumber) {
            drawHNs((evt.action.newHouseNumber ? [evt.action.newHouseNumber] : [evt.action.houseNumber]));
            setMarkersEvents();
        }
        checkMarkersEvents();
    }

    async function reloadClicked() {
        if (preventProcess() || document.querySelector('wz-button.overlay-button.reload-button').classList.contains('disabled'))
            return;
        await destroyAllHNs();
        processSegs('reload', W.model.segments.getByAttributes({ hasHNs: true }));
    }

    function initBackgroundTasks(status) {
        if (status === 'enable') {
            _HNLayerObserver = new MutationObserver((mutationsList) => {
                mutationsList.forEach((mutation) => {
                    if (mutation.type === 'attributes') {
                        if ((mutation.oldValue?.indexOf('active') > -1) && (_holdFeatures.hn.length > 0) && (_wmeHnLayer.div.querySelectorAll('.active').length === 0))
                            flushHeldFeatures();
                        if ((mutation.oldValue?.indexOf('active') === -1) && mutation.target.classList.contains('active'))
                            checkMarkersEvents(true, 0, true, mutation.target);
                        const input = document.querySelector('div.olLayerDiv.house-numbers-layer div.house-number div.content.active:not(.new) input.number');
                        if (input?.value === '')
                            input.addEventListener('change', setMarkersEvents);
                    }
                });
            });
            _saveButtonObserver = new MutationObserver((mutationsList) => {
                if ((W.model.actionManager._redoStack.length === 0)
                    // 2023.04.06.01: Production save button observer mutations
                    && (mutationsList.some((mutation) => (mutation.attributeName === 'class')
                            && mutation.target.classList.contains('waze-icon-save')
                            && (mutation.oldValue.indexOf('ItemDisabled') === -1)
                            && mutation.target.classList.contains('ItemDisabled'))
                    // 2023.04.06.01: Beta save button observer mutations
                        || mutationsList.some((mutation) => ((mutation.attributeName === 'disabled')
                            && (mutation.oldValue === 'false')
                            && (mutation.target.attributes.disabled.value === 'true')))
                    )
                ) {
                    if (W.editingMediator.attributes.editingHouseNumbers)
                        processSegs('afterSave', W.model.segments.getByIds(_segmentsToProcess), true);
                    else
                        processSegmentsToRemove();
                }
            });
            _saveButtonObserver.observe(document.querySelector('#toolbar .js-save-popover-target'), {
                childList: false, attributes: true, attributeOldValue: true, characterData: false, characterDataOldValue: false, subtree: false
            });
            _saveButtonObserver.observing = true;
            W.accelerators.events.on({ reloadData: destroyAllHNs });
            document.querySelector('wz-button.overlay-button.reload-button').addEventListener('click', reloadClicked);
            W.model.segments.on('objectsadded', segmentsEvent, { action: 'objectsadded' });
            W.model.segments.on('objectsremoved', segmentsEvent, { action: 'objectsremoved' });
            W.model.segments.on('objectssynced', segmentsEvent, { action: 'objectssynced' });
            W.model.segments.on('objects-state-deleted', segmentsEvent, { action: 'objects-state-deleted' });
            W.model.segments.on('objectschanged-id', segmentsEvent, { action: 'objectschanged-id' });
            W.model.segmentHouseNumbers.on({
                objectsadded: objectsAddedHNs,
                objectschanged: objectsChangedHNs,
                'objectschanged-id': objectsChangedIdHNs,
                'objects-state-deleted': objectsStateDeletedHNs
            });
            W.editingMediator.on({ 'change:editingHouseNumbers': observeHNLayer });
            W.map.events.on({
                zoomend: zoomEndEvent, addlayer: checkLayerIndex, removelayer: checkLayerIndex
            });
            WazeWrap.Events.register('afterundoaction', this, afterActionsEvent);
            WazeWrap.Events.register('afteraction', this, afterActionsEvent);
            WazeWrap.Events.register('afterclearactions', this, afterActionsEvent);
            _scriptActive = true;
        }
        else if (status === 'disable') {
            _HNLayerObserver = undefined;
            _saveButtonObserver = undefined;
            W.accelerators.events.on('reloadData', null, destroyAllHNs);
            document.querySelector('wz-button.overlay-button.reload-button').removeEventListener('click', reloadClicked);
            W.model.segments.off('objectsadded', segmentsEvent, { action: 'objectsadded' });
            W.model.segments.off('objectsremoved', segmentsEvent, { action: 'objectsremoved' });
            W.model.segments.off('objectschanged', segmentsEvent, { action: 'objectschanged' });
            W.model.segments.off('objects-state-deleted', segmentsEvent, { action: 'objects-state-deleted' });
            W.model.segments.off('objectschanged-id', segmentsEvent, { action: 'objectschanged-id' });
            W.model.segmentHouseNumbers.off({
                objectsadded: objectsAddedHNs,
                objectschanged: objectsChangedHNs,
                'objectschanged-id': objectsChangedIdHNs,
                'objects-state-deleted': objectsStateDeletedHNs,
                objectsremoved: removeHNs
            });
            W.editingMediator.off({ 'change:editingHouseNumbers': observeHNLayer });
            W.map.events.unregister('zoomend', null, zoomEndEvent);
            W.map.events.unregister('addlayer', null, checkLayerIndex);
            W.map.events.unregister('removelayer', null, checkLayerIndex);
            WazeWrap.Events.unregister('afterundoaction', this, afterActionsEvent);
            WazeWrap.Events.unregister('afteraction', this, afterActionsEvent);
            _scriptActive = false;
        }
        return Promise.resolve();
    }

    function enterHNEditMode(segment, moveMap) {
        if (segment) {
            if (moveMap)
                W.map.setCenter(new OpenLayers.LonLat(segment.getCenter().x, segment.getCenter().y), W.map.getZoom());
            W.selectionManager.setSelectedModels(segment);
            document.querySelector('#segment-edit-general .edit-house-numbers').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
    }

    function showTooltip(evt) {
        if ((W.map.getZoom() < 16) || W.editingMediator.attributes.editingHouseNumbers || !_settings.enableTooltip)
            return;
        if (evt?.object?.featureId) {
            checkTooltip();
            let moveMap = false;
            const { segmentId, hnNumber } = evt.object;
            if (_popup.inUse && (_popup.hnNumber === hnNumber) && (_popup.segmentId === segmentId))
                return;
            const segment = W.model.segments.getObjectById(segmentId),
                street = W.model.streets.getObjectById(segment.attributes.primaryStreetID),
                popupPixel = W.map.getPixelFromLonLat(evt.object.lonlat),
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
            divElemRootDivDiv.appendChild(createElem('div', { class: 'title', dir: 'auto', textContent: `${hnNumber} ${(street ? street.name : '')}` }));
            divElemRootDivDiv.appendChild(createElem('div', {
                id: 'hnNavPointsTooltipDiv-edit', class: 'edit-button fa fa-pencil', style: segment.canEditHouseNumbers() ? '' : 'display:none;'
            }, [{ click: invokeEnterHNEditMode }]));
            const divElemRootDiv = createElem('div', {
                id: 'hnNavPointsTooltipDiv-content', class: 'tippy-content', 'data-state': 'hidden', style: 'transition-duration: 300ms;'
            });
            divElemRootDiv.appendChild(divElemRootDivDiv);
            divElemRoot.appendChild(divElemRootDiv);
            divElemRoot.appendChild(createElem('div', {
                id: 'hnNavPointsTooltipDiv-arrow', class: 'tippy-arrow', style: 'position: absolute; left: 0px;'
            }));
            const hnNavPointsTooltipDiv = document.getElementById('hnNavPointsTooltipDiv');
            hnNavPointsTooltipDiv.replaceChildren(divElemRoot);
            popupPixel.origX = popupPixel.x;
            const popupWidthHalf = (hnNavPointsTooltipDiv.clientWidth / 2);
            let arrowOffset = (popupWidthHalf - 15),
                dataPlacement = 'top';
            popupPixel.x = ((popupPixel.x - popupWidthHalf + 5) > 0) ? (popupPixel.x - popupWidthHalf + 5) : 10;
            if (popupPixel.x === 10)
                arrowOffset = popupPixel.origX - 22;
            if ((popupPixel.x + (popupWidthHalf * 2)) > W.map.getEl()[0].clientWidth) {
                popupPixel.x = (popupPixel.origX - hnNavPointsTooltipDiv.clientWidth + 8);
                arrowOffset = (hnNavPointsTooltipDiv.clientWidth - 30);
                moveMap = true;
            }
            if (popupPixel.y - [...hnNavPointsTooltipDiv.children].reduce((height, elem) => height + elem.getBoundingClientRect().height, 0) < 0) {
                popupPixel.y += 14;
                dataPlacement = 'bottom';
            }
            else {
                popupPixel.y -= ([...hnNavPointsTooltipDiv.children].reduce((height, elem) => height + elem.getBoundingClientRect().height, 0) + 14);
            }
            hnNavPointsTooltipDiv.style.transform = `translate(${Math.round(popupPixel.x)}px, ${Math.round(popupPixel.y)}px)`;
            hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-arrow').style.transform = `translate(${Math.max(0, Math.round(arrowOffset))}px, 0px)`;
            hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-tooltip').setAttribute('data-placement', dataPlacement);
            hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-tooltip').setAttribute('data-state', 'visible');
            hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-content').setAttribute('data-state', 'visible');
            _popup = { segmentId, hNumber: hnNumber, inUse: true };
        }
    }

    function stripTooltipHTML() {
        checkTimeout({ timeout: 'stripTooltipHTML' });
        const hnNavPointsTooltipDiv = document.getElementById('hnNavPointsTooltipDiv');
        hnNavPointsTooltipDiv.replaceChildren();
        _popup = { segmentId: -1, hnNumber: -1, inUse: false };
    }

    function hideTooltip() {
        checkTimeout({ timeout: 'hideTooltip' });
        const hnNavPointsTooltipDiv = document.getElementById('hnNavPointsTooltipDiv');
        hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-content')?.setAttribute('data-state', 'hidden');
        hnNavPointsTooltipDiv.querySelector('#hnNavPointsTooltipDiv-tooltip')?.setAttribute('data-state', 'hidden');
        _timeouts.stripTooltipHTML = window.setTimeout(stripTooltipHTML, 400);
    }

    function hideTooltipDelay(evt) {
        if (!evt)
            return;
        checkTimeout({ timeout: 'hideTooltip' });
        const parentsArr = evt.toElement?.offsetParent ? [evt.toElement.offsetParent, evt.toElement.offsetParent.offSetParent] : [],
            hnNavPointsNumbersLayer = W.map.getLayerByName('HN NavPoints Numbers Layer'),
            hnNavPointsTooltipDiv = document.getElementById('hnNavPointsTooltipDiv');
        if (evt.toElement && (parentsArr.includes(hnNavPointsNumbersLayer?.div) || parentsArr.includes(hnNavPointsTooltipDiv)))
            return;
        _timeouts.hideTooltip = window.setTimeout(hideTooltip, 100, evt);
    }

    function checkTooltip() {
        checkTimeout({ timeout: 'hideTooltip' });
    }

    function checkLayerIndex() {
        const layerIdx = W.map.layers.map((a) => a.uniqueName).indexOf('__HNNavPointsNumbersLayer');
        let properIdx;
        if (_settings.keepHNLayerOnTop) {
            const layersIndexes = [],
                layersLoaded = W.map.layers.map((a) => a.uniqueName);
            ['wmeGISLayersDefault', '__HNNavPointsLayer'].forEach((layerUniqueName) => {
                if (layersLoaded.indexOf(layerUniqueName) > 0)
                    layersIndexes.push(layersLoaded.indexOf(layerUniqueName));
            });
            properIdx = (Math.max(...layersIndexes) + 1);
        }
        else {
            properIdx = (W.map.layers.map((a) => a.uniqueName).indexOf('__HNNavPointsLayer') + 1);
        }
        if (layerIdx !== properIdx) {
            W.map.layers.splice(properIdx, 0, W.map.layers.splice(layerIdx, 1)[0]);
            W.map.getOLMap().resetLayersZIndex();
        }
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
        const navPointsNumbersLayersOptions = {
                displayInLayerSwitcher: true,
                uniqueName: '__HNNavPointsNumbersLayer',
                selectable: true,
                labelSelect: true,
                rendererOptions: { zIndexing: true },
                styleMap: new OpenLayers.StyleMap({
                    default: new OpenLayers.Style({
                        strokeColor: '${Color}',
                        strokeOpacity: 1,
                        strokeWidth: 3,
                        fillColor: '${Color}',
                        fillOpacity: 0.5,
                        pointerEvents: 'visiblePainted',
                        label: '${hNumber}',
                        fontSize: '12px',
                        fontFamily: 'Rubik, Boing-light, sans-serif;',
                        fontWeight: 'bold',
                        direction: '${textDir}',
                        labelOutlineColor: '${Color}',
                        labelOutlineWidth: 3,
                        labelSelect: true
                    })
                })
            },
            handleCheckboxToggle = function () {
                const settingName = this.id.substring(14);
                if (settingName === 'enableTooltip') {
                    let hnNavPointsNumbersLayer = W.map.getLayerByName('HN NavPoints Numbers Layer');
                    if (!this.checked)
                        hnNavPointsNumbersLayer.clearMarkers();
                    else
                        hnNavPointsNumbersLayer.destroyFeatures();
                    W.map.removeLayer(hnNavPointsNumbersLayer);
                    if (this.checked)
                        hnNavPointsNumbersLayer = new OpenLayers.Layer.Markers('HN NavPoints Numbers Layer', navPointsNumbersLayersOptions);
                    else
                        hnNavPointsNumbersLayer = new OpenLayers.Layer.Vector('HN NavPoints Numbers Layer', navPointsNumbersLayersOptions);
                    W.map.addLayer(hnNavPointsNumbersLayer);
                    hnNavPointsNumbersLayer.setVisibility(_settings.hnNumbers);
                }
                _settings[settingName] = this.checked;
                if (settingName === 'keepHNLayerOnTop')
                    checkLayerIndex();
                saveSettingsToStorage();
                if ((settingName === 'enableTooltip') && (W.map.getZoom() > (_settings.disableBelowZoom - 1)) && (_settings.hnLines || _settings.hnNumbers))
                    processSegs('settingChanged', W.model.segments.getByAttributes({ hasHNs: true }), true, 0);
            },
            handleTextboxChange = function () {
                const newVal = Math.min(22, Math.max(16, +this.value));
                if ((newVal !== _settings.disableBelowZoom) || (+this.value !== newVal)) {
                    if (newVal !== +this.value)
                        this.value = newVal;
                    _settings.disableBelowZoom = newVal;
                    saveSettingsToStorage();
                    if ((W.map.getZoom() < newVal) && (_settings.hnLines || _settings.hnNumbers))
                        processSegs('settingChanged', null, true, 0);
                    else if (_settings.hnLines || _settings.hnNumbers)
                        processSegs('settingChanged', W.model.segments.getByAttributes({ hasHNs: true }), true, 0);
                }
            },
            buildCheckbox = (id = '', textContent = '', checked = true, title = '', disabled = false) => createElem('wz-checkbox', {
                id, title, disabled, checked, textContent
            }, [{ change: handleCheckboxToggle }]),
            buildTextBox = (id = '', label = '', value = '', placeholder = '', maxlength = 0, autocomplete = 'off', title = '', disabled = false) => createElem('wz-text-input', {
                id, label, value, placeholder, maxlength, autocomplete, title, disabled
            }, [{ change: handleTextboxChange }]);
        await loadSettingsFromStorage();
        WazeWrap.Interface.AddLayerCheckbox('display', 'HN NavPoints', _settings.hnLines, hnLayerToggled);
        WazeWrap.Interface.AddLayerCheckbox('display', 'HN NavPoints Numbers', _settings.hnNumbers, hnNumbersLayerToggled);

        const hnNavPointsLayer = new OpenLayers.Layer.Vector('HN NavPoints Layer', {
                displayInLayerSwitcher: true,
                uniqueName: '__HNNavPointsLayer'
            }),
            hnNavPointsNumbersLayer = _settings.enableTooltip
                ? new OpenLayers.Layer.Markers('HN NavPoints Numbers Layer', navPointsNumbersLayersOptions)
                : new OpenLayers.Layer.Vector('HN NavPoints Numbers Layer', navPointsNumbersLayersOptions);
        W.map.addLayers([hnNavPointsLayer, hnNavPointsNumbersLayer]);
        hnNavPointsLayer.setVisibility(_settings.hnLines);
        hnNavPointsNumbersLayer.setVisibility(_settings.hnNumbers);
        window.addEventListener('beforeunload', checkShortcutsChanged, false);
        new WazeWrap.Interface.Shortcut(
            'toggleHNNavPointsShortcut',
            'Toggle HN NavPoints layer',
            'layers',
            'layersToggleHNNavPoints',
            _settings.toggleHNNavPointsShortcut,
            () => { document.getElementById('layer-switcher-item_hn_navpoints').dispatchEvent(new MouseEvent('click', { bubbles: true })); },
            null
        ).add();
        new WazeWrap.Interface.Shortcut(
            'toggleHNNavPointsNumbersShortcut',
            'Toggle HN NavPoints Numbers layer',
            'layers',
            'layersToggleHNNavPointsNumbers',
            _settings.toggleHNNavPointsNumbersShortcut,
            () => { document.getElmentById('layer-switcher-item_hn_navpoints_numbers').dispatchEvent(new MouseEvent('click', { bubbles: true })); },
            null
        ).add();
        const { tabLabel, tabPane } = W.userscripts.registerSidebarTab('HN-NavPoints');
        tabLabel.appendChild(createElem('i', { class: 'w-icon w-icon-location' }));
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
        await W.userscripts.waitForElementConnected(tabPane);
        if (!document.getElementById('hnNavPointsTooltipDiv')) {
            W.map.getEl()[0].appendChild(createElem('div', {
                id: 'hnNavPointsTooltipDiv',
                style: 'z-index:9999; visibility:visible; position:absolute; inset: auto auto 0px 0px; margin: 0px; top: 0px; left: 0px;',
                'data-tippy-root': false
            }, [{ mouseenter: checkTooltip }, { mouseleave: hideTooltipDelay }]));
        }
        await initBackgroundTasks('enable');
        checkLayerIndex();
        log(`Fully initialized in ${Math.round(performance.now() - _LOAD_BEGIN_TIME)} ms.`);
        showScriptInfoAlert();
        if (_scriptActive)
            processSegs('init', W.model.segments.getByAttributes({ hasHNs: true }));
        setTimeout(checkShortcutsChanged, 10000);
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

    function bootstrap() {
        if (!W) {
            logDebug('W is not available. Adding event listener.');
            document.addEventListener('wme-initialized', onWmeInitialized, { once: true });
        }
        else {
            onWmeInitialized();
        }
    }

    bootstrap();
}
)();
