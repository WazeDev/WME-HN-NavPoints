/* eslint-disable no-template-curly-in-string */
// ==UserScript==
// @name            WME HN NavPoints
// @namespace       https://greasyfork.org/users/166843
// @description     Shows navigation points of all house numbers in WME
// @version         2021.08.26.01
// @author          dBsooner
// @grant           none
// @require         https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @license         GPLv3
// @include         /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @contributionURL https://github.com/WazeDev/Thank-The-Authors
// ==/UserScript==

/* global _, $, document, GM_info, localStorage, MutationObserver, OpenLayers, performance, W, WazeWrap, window */

/*
 * Original concept and code for WME HN NavPoints was written by MajkiiTelini. After version 0.6.6, this
 * script is maintained by the WazeDev team. Special thanks is definitely given to MajkiiTelini for his
 * hard work and dedication to the original script.
 *
 */

const ALERT_UPDATE = true,
    DEBUG = false,
    LOAD_BEGIN_TIME = performance.now(),
    SCRIPT_FORUM_URL = 'https://www.waze.com/forum/viewtopic.php?f=819&t=289116',
    SCRIPT_GF_URL = 'https://greasyfork.org/en/scripts/390565-wme-hn-navpoints',
    SCRIPT_NAME = GM_info.script.name.replace('(beta)', 'β'),
    SCRIPT_VERSION = GM_info.script.version,
    SCRIPT_VERSION_CHANGES = [
        '<b>CHANGE:</b> Update zoom levels to new WME numbers.'
    ],
    SETTINGS_STORE_NAME = 'WMEHNNavPoints',
    _spinners = {
        destroyAllHNs: false,
        drawHNs: false,
        processSegs: false
    },
    _timeouts = {
        bootstrap: undefined,
        hideTooltip: undefined,
        saveSettingsToStorage: undefined,
        setMarkersEvents: undefined
    };

let _settings = {},
    _scriptActive = false,
    _HNLayerObserver,
    _saveButtonObserver,
    _HNNavPointsLayer,
    _HNNavPointsNumbersLayer,
    _wmeHnLayer,
    _processedSegments = [],
    _segmentsToProcess = [],
    _segmentsToRemove = [],
    _$hnNavPointsTooltipDiv,
    /* 2020.07.16.01 - Removed in favor of dual layer types: one for Vector (no tooltip popup) and one for marker (tooltip popup).
       Prior to this it was an attempt to work with several OL SelectFeatures controllers. However, it doesn't seem possible with OL 2.
     _hnMouseoverCtrl,
    */
    _popup = {
        inUse: false,
        hnNumber: -1,
        segmentId: -1
    };

function log(message) { console.log('WME-HN-NavPoints:', message); }
function logError(message) { console.error('WME-HN-NavPoints:', message); }
// function logWarning(message) { console.warn('WME-HN-NavPoints:', message); }
function logDebug(message) {
    if (DEBUG)
        console.log('WME-HN-NavPoints:', message);
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
        loadedSettings = $.parseJSON(localStorage.getItem(SETTINGS_STORE_NAME));
    _settings = $.extend({}, defaultSettings, loadedSettings);
    const serverSettings = await WazeWrap.Remote.RetrieveSettings(SETTINGS_STORE_NAME);
    if (serverSettings && (serverSettings.lastSaved > _settings.lastSaved))
        $.extend(_settings, serverSettings);
    if (_settings.disableBelowZoom < 11) {
        switch (_settings.disableBelowZoom) {
            case 4:
                _settings.disableBelowZoom = 18;
                break;
            case 5:
                _settings.disableBelowZoom = 17;
                break;
            case 6:
                _settings.disableBelowZoom = 16;
                break;
            case 7:
                _settings.disableBelowZoom = 15;
                break;
            case 8:
                _settings.disableBelowZoom = 14;
                break;
            case 9:
                _settings.disableBelowZoom = 13;
                break;
            case 10:
                _settings.disableBelowZoom = 12;
                break;
            default:
                _settings.disableBelowZoom = 17;
        }
    }
    _timeouts.saveSettingsToStorage = window.setTimeout(saveSettingsToStorage, 5000);

    return Promise.resolve();
}

function saveSettingsToStorage() {
    checkTimeout({ timeout: 'saveSettingsToStorage' });
    if (localStorage) {
        _settings.lastVersion = SCRIPT_VERSION;
        _settings.lastSaved = Date.now();
        localStorage.setItem(SETTINGS_STORE_NAME, JSON.stringify(_settings));
        WazeWrap.Remote.SaveSettings(SETTINGS_STORE_NAME, _settings);
        logDebug('Settings saved.');
    }
}

function showScriptInfoAlert() {
    if (ALERT_UPDATE && SCRIPT_VERSION !== _settings.lastVersion) {
        let releaseNotes = '';
        releaseNotes += '<p>What\'s New:</p>';
        if (SCRIPT_VERSION_CHANGES.length > 0) {
            releaseNotes += '<ul>';
            for (let idx = 0; idx < SCRIPT_VERSION_CHANGES.length; idx++)
                releaseNotes += `<li>${SCRIPT_VERSION_CHANGES[idx]}`;
            releaseNotes += '</ul>';
        }
        else {
            releaseNotes += '<ul><li>Nothing major.</ul>';
        }
        WazeWrap.Interface.ShowScriptUpdate(SCRIPT_NAME, SCRIPT_VERSION, releaseNotes, SCRIPT_GF_URL, SCRIPT_FORUM_URL);
    }
}

function checkShortcutsChanged() {
    let triggerSave = false;
    ['toggleHNNavPointsShortcut', 'toggleHNNavPointsNumbersShortcut'].forEach(k => {
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
        if (_timeouts[obj.timeout] && (_timeouts[obj.timeout][obj.toIndex] !== undefined)) {
            window.clearTimeout(_timeouts[obj.timeout][obj.toIndex]);
            _timeouts[obj.timeout][obj.toIndex] = undefined;
        }
    }
    else {
        if (_timeouts[obj.timeout] !== undefined)
            window.clearTimeout(_timeouts[obj.timeout]);
        _timeouts[obj.timeout] = undefined;
    }
}

function doSpinner(spinnerName = '', spin = true) {
    const $btn = $('#hnNPSpinner');
    if (!spin) {
        _spinners[spinnerName] = false;
        if (!Object.values(_spinners).some(a => a === true)) {
            if ($btn.length > 0) {
                $btn.removeClass('fa-spin');
                $('#divHnNPSpinner').hide();
            }
            else {
                $('#topbar-container .topbar').prepend(
                    '<div id="divHnNPSpinner" title="WME HN NavPoints is currently processing house numbers." style="font-size:20px;background:white;float:left;margin-left:-20px;display:none;">'
                    + '<i id="hnNPSpinner" class="fa fa-spinner"></i></div>'
                );
            }
        }
    }
    else {
        _spinners[spinnerName] = true;
        if ($btn.length === 0) {
            _spinners[spinnerName] = true;
            $('#topbar-container .topbar').prepend(
                '<div id="divHnNPSpinner" title="WME HN NavPoints is currently processing house numbers." style="font-size:20px;background:white;float:left;margin-left:-20px;">'
                + '<i id="hnNPSpinner" class="fa fa-spinner fa-spin"></i></div>'
            );
        }
        else if (!$btn.hasClass('fa-spin')) {
            $btn.addClass('fa-spin');
            $('#divHnNPSpinner').show();
        }
    }
}

function processSegmentsToRemove() {
    if (_segmentsToRemove.length > 0) {
        const removeMarker = marker => { _HNNavPointsNumbersLayer.removeMarker(marker); };
        let linesToRemove = [],
            hnsToRemove = [];
        for (let i = _segmentsToRemove.length - 1; i > -1; i--) {
            const segId = _segmentsToRemove[i];
            if (!W.model.segments.objects[segId]) {
                _segmentsToRemove.splice(i, 1);
                linesToRemove = linesToRemove.concat(_HNNavPointsLayer.getFeaturesByAttribute('segmentId', segId));
                if (!_settings.enableTooltip)
                    hnsToRemove = hnsToRemove.concat(_HNNavPointsNumbersLayer.getFeaturesByAttribute('segmentId', segId));
                else
                    _HNNavPointsNumbersLayer.markers.filter(marker => marker.segmentId === segId).forEach(marker => removeMarker(marker));
            }
        }
        if (linesToRemove.length > 0)
            _HNNavPointsLayer.removeFeatures(linesToRemove);
        if (hnsToRemove.length > 0)
            _HNNavPointsNumbersLayer.removeFeatures(hnsToRemove);
    }
}

async function hnLayerToggled(checked) {
    _HNNavPointsLayer.setVisibility(checked);
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
    _HNNavPointsNumbersLayer.setVisibility(checked);
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
        _HNLayerObserver.observe(_wmeHnLayer.div, { childList: false, subtree: true, attributes: true });
        _HNLayerObserver.observing = true;
    }
    else if (_HNLayerObserver.observing) {
        _HNLayerObserver.disconnect();
        _HNLayerObserver.observing = false;
    }
    if (!_HNLayerObserver.observing) {
        W.model.segmentHouseNumbers.clear();
        processSegs('exithousenumbers', W.model.segments.getByIds(_segmentsToProcess), true);
        processSegmentsToRemove();
        _wmeHnLayer = undefined;
    }
    else {
        _segmentsToProcess = W.selectionManager.getSegmentSelection().segments.map(segment => segment.attributes.id);
        _segmentsToRemove = [];
    }
    _saveButtonObserver.disconnect();
    _saveButtonObserver.observe($('#edit-buttons .waze-icon-save')[0], {
        childList: false, attributes: true, attributeOldValue: true, characterData: false, characterDataOldValue: false, subtree: false
    });
}

function removeHNs(objArr) {
    let linesToRemove = [],
        hnsToRemove = [];
    objArr.forEach(hnObj => {
        linesToRemove = linesToRemove.concat(_HNNavPointsLayer.getFeaturesByAttribute('featureId', hnObj.attributes.id));
        if (!_settings.enableTooltip)
            hnsToRemove = hnsToRemove.concat(_HNNavPointsNumbersLayer.getFeaturesByAttribute('featureId', hnObj.attributes.id));
        else
            _HNNavPointsNumbersLayer.markers.filter(a => a.featureId === hnObj.attributes.id).forEach(marker => { _HNNavPointsNumbersLayer.removeMarker(marker); });
    });
    if (linesToRemove.length > 0)
        _HNNavPointsLayer.removeFeatures(linesToRemove);
    if (hnsToRemove.length > 0)
        _HNNavPointsNumbersLayer.removeFeatures(hnsToRemove);
}

function drawHNs(houseNumberArr) {
    if (houseNumberArr.length === 0)
        return;
    doSpinner('drawHNs', true);
    const lineFeatures = [],
        numberFeatures = !_settings.enableTooltip ? [] : undefined,
        svg = _settings.enableTooltip ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : undefined,
        svgText = _settings.enableTooltip ? document.createElementNS('http://www.w3.org/2000/svg', 'text') : undefined,
        invokeTooltip = _settings.enableTooltip ? evt => { showTooltip(evt); } : undefined;
    if (_settings.enableTooltip) {
        svg.setAttribute('xlink', 'http://www.w3.org/1999/xlink');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('viewBox', '0 0 40 14');
        svgText.setAttribute('text-anchor', 'middle');
        svgText.setAttribute('x', '20');
        svgText.setAttribute('y', '10');
    }
    for (let i = 0; i < houseNumberArr.length; i++) {
        const hnObj = houseNumberArr[i],
            segmentId = hnObj.getSegmentId(),
            seg = W.model.segments.objects[segmentId];
        if (seg) {
            const featureId = hnObj.getID(),
                markerIdx = _settings.enableTooltip ? _HNNavPointsNumbersLayer.markers.map(marker => marker.featureId).indexOf(featureId) : undefined,
                // eslint-disable-next-line no-nested-ternary
                hnToRemove = _settings.enableTooltip ? (markerIdx > -1) ? _HNNavPointsNumbersLayer.markers[markerIdx] : [] : _HNNavPointsNumbersLayer.getFeaturesByAttribute('featureId', featureId),
                rtlChar = /[\u0590-\u083F]|[\u08A0-\u08FF]|[\uFB1D-\uFDFF]|[\uFE70-\uFEFF]/mg,
                textDir = (hnObj.getNumber().match(rtlChar) !== null) ? 'rtl' : 'ltr';
            _HNNavPointsLayer.removeFeatures(_HNNavPointsLayer.getFeaturesByAttribute('featureId', featureId));
            if (hnToRemove.length > 0) {
                if (_settings.enableTooltip)
                    _HNNavPointsNumbersLayer.removeMarker(hnToRemove);
                else
                    _HNNavPointsNumbersLayer.removeFeatures(_HNNavPointsNumbersLayer.getFeaturesByAttribute('featureId', featureId));
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
                svg.innerHTML = svgText.outerHTML;
                const svgIcon = new WazeWrap.Require.Icon(`data:image/svg+xml,${svg.outerHTML}`, { w: 40, h: 18 }),
                    markerFeature = new OpenLayers.Marker(new OpenLayers.LonLat(p2.x, p2.y), svgIcon);
                markerFeature.events.register('mouseover', null, invokeTooltip);
                markerFeature.events.register('mouseout', null, hideTooltipDelay);
                markerFeature.featureId = featureId;
                markerFeature.segmentId = segmentId;
                markerFeature.hnNumber = hnObj.getNumber() || '';
                _HNNavPointsNumbersLayer.addMarker(markerFeature);
            }
            else {
                // eslint-disable-next-line new-cap
                numberFeatures.push(new OpenLayers.Feature.Vector(new OpenLayers.Geometry.Polygon.createRegularPolygon(p2, 1, 20), {
                    segmentId, featureId, hn_number: hnObj.getNumber(), strokeWidth: 3, Color: strokeColor, textDir
                }));
            }
        }
    }
    if (lineFeatures.length > 0)
        _HNNavPointsLayer.addFeatures(lineFeatures);
    if (!_settings.enableTooltip && (numberFeatures.length > 0))
        _HNNavPointsNumbersLayer.addFeatures(numberFeatures);
    doSpinner('drawHNs', false);
}

function destroyAllHNs() {
    doSpinner('destroyAllHNs', true);
    _HNNavPointsLayer.destroyFeatures();
    if (_settings.enableTooltip)
        _HNNavPointsNumbersLayer.clearMarkers();
    else
        _HNNavPointsNumbersLayer.destroyFeatures();
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
        findObjIndex = (array, fldName, value) => array.map(a => a[fldName]).indexOf(value),
        processError = (err, chunk) => {
            logDebug(`Retry: ${retry}`);
            if (retry < 5)
                processSegs(action, chunk, true, ++retry);
            else
                logError(`Get HNs for ${chunk.length} segments failed. Code: ${err.status} - Text: ${err.responseText}`);
        },
        processJSON = jsonData => {
            if (jsonData && (jsonData.error === undefined) && (typeof jsonData.segmentHouseNumbers.objects !== 'undefined'))
                drawHNs(jsonData.segmentHouseNumbers.objects);
        };
    if ((action === 'objectsremoved')) {
        if (arrSegObjs && (arrSegObjs.length > 0)) {
            const removedSegIds = [];
            let hnNavPointsToRemove = [],
                hnNavPointsNumbersToRemove = [];
            arrSegObjs.forEach(segObj => {
                const segmentId = segObj.getID();
                if (!eg.intersects(segObj.geometry) && (segmentId > 0)) {
                    hnNavPointsToRemove = hnNavPointsToRemove.concat(_HNNavPointsLayer.getFeaturesByAttribute('segmentId', segmentId));
                    if (!_settings.enableTooltip)
                        hnNavPointsNumbersToRemove = hnNavPointsNumbersToRemove.concat(_HNNavPointsNumbersLayer.getFeaturesByAttribute('segmentId', segmentId));
                    else
                        removedSegIds.push(segmentId);
                    const segIdx = findObjIndex(_processedSegments, 'segId', segmentId);
                    if (segIdx > -1)
                        _processedSegments.splice(segIdx, 1);
                }
            });
            if (hnNavPointsToRemove.length > 0)
                _HNNavPointsLayer.removeFeatures(hnNavPointsToRemove);
            if (hnNavPointsNumbersToRemove.length > 0)
                _HNNavPointsNumbersLayer.removeFeatures(hnNavPointsNumbersToRemove);
            if (removedSegIds.length > 0) {
                _HNNavPointsNumbersLayer.markers.filter(marker => removedSegIds.includes(marker.segmentId)).forEach(marker => {
                    _HNNavPointsNumbersLayer.removeMarker(marker);
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
                W.controller.descartesClient.getHouseNumbers(chunk.map(segObj => segObj.getID())).then(processJSON).catch(error => processError(error, [...chunk]));
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
        if (evt.object && evt.object.dragging && !evt.object.dragging.last)
            removeHNs([evt.object.model]);
    }
    else if (evt.type === 'delete') {
        removeHNs([evt.object.model]);
    }
}

function setMarkersEvents() {
    if (W.editingMediator.attributes.editingHouseNumbers) {
        checkTimeout({ timeout: 'setMarkersEvents' });
        hideTooltip();
        if (!_wmeHnLayer || (_wmeHnLayer && (_wmeHnLayer.markers.length === 0))) {
            _timeouts.setMarkersEvents = window.setTimeout(setMarkersEvents, 50);
            return;
        }
        _wmeHnLayer.markers.forEach(marker => {
            marker.events.unregister('click:input', null, markerEvent);
            marker.events.unregister('delete', null, markerEvent);
            marker.events.on({ 'click:input': markerEvent, delete: markerEvent });
        });
    }
    else if (_wmeHnLayer) {
        _wmeHnLayer.markers.forEach(marker => {
            marker.events.unregister('click:input', null, markerEvent);
            marker.events.unregister('delete', null, markerEvent);
        });
    }
}

function checkMarkersEvents() {
    if (_wmeHnLayer && (_wmeHnLayer.markers.length > 0) && !_wmeHnLayer.markers[0].events.listeners['click:input'].some(callbackFn => callbackFn.func === markerEvent))
        setMarkersEvents();
}

function segmentsEvent(evt) {
    if (!evt || preventProcess())
        return;
    if ((this.action === 'objectssynced') || (this.action === 'objectsremoved'))
        processSegmentsToRemove();
    if (this.action === 'objectschanged-id') {
        const oldSegmentId = evt.oldID,
            newSegmentID = evt.newID;
        _HNNavPointsLayer.getFeaturesByAttribute('segmentId', oldSegmentId).forEach(feature => { feature.attributes.segmentId = newSegmentID; });
        if (_settings.enableTooltip)
            _HNNavPointsNumbersLayer.markers.filter(marker => marker.segmentId === oldSegmentId).forEach(marker => { marker.segmentId = newSegmentID; });
        else
            _HNNavPointsNumbersLayer.getFeaturesByAttribute('segmentId', oldSegmentId).forEach(feature => { feature.attributes.segmentId = newSegmentID; });
    }
    else if (this.action === 'objects-state-deleted') {
        evt.forEach(obj => {
            if (_segmentsToRemove.indexOf(obj.getID()) === -1)
                _segmentsToRemove.push(obj.getID());
        });
    }
    else {
        processSegs(this.action, evt.filter(seg => seg.attributes.hasHNs));
    }
}

function objectsChangedIdHNs(evt) {
    if (!evt || preventProcess())
        return;
    const oldFeatureId = evt.oldID,
        newFeatureId = evt.newID;
    _HNNavPointsLayer.getFeaturesByAttribute('featureId', oldFeatureId).forEach(feature => { feature.attributes.featureId = newFeatureId; });
    if (_settings.enableTooltip)
        _HNNavPointsNumbersLayer.markers.filter(marker => marker.featureId === oldFeatureId).forEach(marker => { marker.featureId = newFeatureId; });
    else
        _HNNavPointsNumbersLayer.getFeaturesByAttribute('featureId', oldFeatureId).forEach(feature => { feature.attributes.featureId = newFeatureId; });
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
    checkMarkersEvents();
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
    else if (evt.action._description && (evt.action._description.indexOf('Deleted house number') > -1)) {
        if (evt.type === 'afterundoaction')
            drawHNs([evt.action.object]);
        else
            removeHNs(evt.action.object);
        setMarkersEvents();
    }
    else if (evt.action._description && (evt.action._description.indexOf('Updated house number') > -1)) {
        const tempEvt = _.cloneDeep(evt);
        if (evt.type === 'afterundoaction') {
            if (tempEvt.action.newAttributes && tempEvt.action.newAttributes.number)
                tempEvt.action.attributes.number = tempEvt.action.newAttributes.number;
        }
        else if (evt.type === 'afteraction') {
            if (tempEvt.action.oldAttributes && tempEvt.action.oldAttributes.number)
                tempEvt.action.attributes.number = tempEvt.action.oldAttributes.number;
        }
        removeHNs(tempEvt.action.object);
        drawHNs([evt.action.object]);
        setMarkersEvents();
    }
    else if (evt.action._description && (evt.action._description.indexOf('Added house number') > -1)) {
        if (evt.type === 'afterundoaction')
            removeHNs(evt.action.houseNumber);
        else
            drawHNs([evt.action.houseNumber]);
    }
    else if (evt.action._description && (evt.action._description.indexOf('Moved house number') > -1)) {
        drawHNs([evt.action.newHouseNumber]);
    }
    else if (evt.action && evt.action.houseNumber) {
        drawHNs((evt.action.newHouseNumber ? [evt.action.newHouseNumber] : [evt.action.houseNumber]));
        setMarkersEvents();
    }
    checkMarkersEvents();
}

async function reloadClicked() {
    if (preventProcess() || ($('div.item-icon.w-icon.w-icon-refresh').attr('class').indexOf('disabled') > 0))
        return;
    await destroyAllHNs();
    processSegs('reload', W.model.segments.getByAttributes({ hasHNs: true }));
}

function initBackgroundTasks(status) {
    if (status === 'enable') {
        _HNLayerObserver = new MutationObserver(mutationsList => {
            mutationsList.forEach(() => {
                const input = $('div.olLayerDiv.house-numbers-layer div.house-number div.content.active:not(".new") input.number');
                if (input.val() === '')
                    input[0].addEventListener('change', setMarkersEvents);
            });
        });
        _saveButtonObserver = new MutationObserver(mutationsList => {
            if (mutationsList.filter(
                mutation => (mutation.attributeName === 'class')
                    && (mutation.target.classList.contains('waze-icon-save'))
                    && (mutation.oldValue.indexOf('ItemDisabled') === -1)
                    && (mutation.target.classList.contains('ItemDisabled'))
            ).length > 0) {
                if (W.editingMediator.attributes.editingHouseNumbers)
                    processSegs('afterSave', W.model.segments.getByIds(_segmentsToProcess), true);
                else
                    processSegmentsToRemove();
            }
        });
        _saveButtonObserver.observe($('#edit-buttons .waze-icon-save')[0], {
            childList: false, attributes: true, attributeOldValue: true, characterData: false, characterDataOldValue: false, subtree: false
        });
        _saveButtonObserver.observing = true;
        W.accelerators.events.on({ reloadData: destroyAllHNs });
        $('#overlay-buttons, #edit-buttons').on('click', 'div.reload-button-region', reloadClicked);
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
        /* 2020.07.16.01 - See note at top
        _hnMouseoverCtrl.activate();
        */
        _scriptActive = true;
    }
    else if (status === 'disable') {
        _HNLayerObserver = undefined;
        _saveButtonObserver = undefined;
        W.accelerators.events.on('reloadData', null, destroyAllHNs);
        $('#overlay-buttons, #edit-buttons').off('click', 'div.reload-button-region', reloadClicked);
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
        /* 2020.07.16.01 - See note at top
        _hnMouseoverCtrl.deactivate();
        */
        _scriptActive = false;
    }
    return Promise.resolve();
}

function enterHNEditMode(evt) {
    if (evt && evt.data && evt.data.segment) {
        if (evt.data.moveMap)
            W.map.setCenter(new OpenLayers.LonLat(evt.data.segment.getCenter().x, evt.data.segment.getCenter().y), W.map.getZoom());
        W.selectionManager.setSelectedModels(evt.data.segment);
        $('#segment-edit-general .edit-house-numbers').click();
    }
}

function showTooltip(evt) {
    if ((W.map.getZoom() < 16) || W.editingMediator.attributes.editingHouseNumbers || !_settings.enableTooltip)
        return;
    if (evt && evt.object && evt.object.featureId) {
    /* 2020.07.16.01 - See note at top
    if (evt && evt.feature && evt.feature.attributes && evt.feature.attributes.featureId) {
    */
        checkTooltip();
        /* 2020.07.16.01 - See note at top
        const featureArr = evt.feature.attributes.featureId.split('|'),
        */
        const { segmentId, hnNumber } = evt.object;
        if (_popup.inUse && (_popup.hnNumber === hnNumber) && (_popup.segmentId === segmentId))
            return;
        const segment = W.model.segments.getObjectById(segmentId),
            street = W.model.streets.getObjectById(segment.attributes.primaryStreetID),
            popupPixel = W.map.getPixelFromLonLat(evt.object.lonlat),
            /* 2020.07.16.01 - See note at top
            popupPixel = W.map.getPixelFromLonLat(new OpenLayers.LonLat(evt.feature.geometry.getCentroid().x, evt.feature.geometry.getCentroid().y)),
            */
            htmlOut = ''
                + '<div class="tippy-tooltip light-border-theme" id="hnNavPointsTooltipDiv-tooltip" data-size="large" data-animation="shift-away" data-state="visible"'
                + '     data-interactive="" style="transition-duration:325ms; top:0px;">'
                + ' <div class="tippy-arrow" id="hnNavPointsTooltipDiv-arrow" style="left:83px;"></div>'
                + ' <div class="tippy-content" id="hnNavPointsTooltipDiv-content" data-state="visible" style="transition-duration: 325ms;">'
                + '     <div>'
                + '         <div class="house-number-marker-tooltip">'
                + `             <div class="title" dir="auto">${hnNumber} ${(street ? street.name : '')}</div>`
                + `             <div class="edit-button fa fa-pencil" id="hnNavPointsTooltipDiv-edit" ${(segment.canEditHouseNumbers() ? '' : ' style="display:none"')}></div>`
                + '         </div>'
                + '     </div>'
                + ' </div>'
                + '</div>';
        _$hnNavPointsTooltipDiv.html(htmlOut);
        popupPixel.origX = popupPixel.x;
        const popupWidthHalf = (_$hnNavPointsTooltipDiv.width() / 2);
        let arrowOffset = (popupWidthHalf - 15),
            xPlacement = 'top',
            moveMap = false;
        popupPixel.x = ((popupPixel.x - popupWidthHalf) > 0) ? (popupPixel.x - popupWidthHalf) : 10;
        if (popupPixel.x === 10)
            arrowOffset = popupPixel.origX - 22;
        if ((popupPixel.x + (popupWidthHalf * 2)) > $('#map')[0].clientWidth) {
            popupPixel.x = (popupPixel.origX - _$hnNavPointsTooltipDiv.width() + 8);
            arrowOffset = (_$hnNavPointsTooltipDiv.width() - 30);
            moveMap = true;
        }
        if (popupPixel.y - _$hnNavPointsTooltipDiv.height() < 0) {
            popupPixel.y += 10;
            xPlacement = 'bottom';
        }
        else {
            popupPixel.y -= (_$hnNavPointsTooltipDiv.height() + 4);
        }
        $('#hnNavPointsTooltipDiv-edit').on('click', { segment, moveMap }, enterHNEditMode);
        _$hnNavPointsTooltipDiv.css({ transform: `translate3d(${Math.round(popupPixel.x)}px, ${Math.round(popupPixel.y)}px, 0px)` });
        $('#hnNavPointsTooltipDiv-arrow').css('left', Math.round(arrowOffset));
        _$hnNavPointsTooltipDiv.attr('x-placement', xPlacement);
        _$hnNavPointsTooltipDiv.css({ visibility: 'visible' });
        _popup = { segmentId, hn_number: hnNumber, inUse: true };
    }
}

function hideTooltip() {
    checkTimeout({ timeout: 'hideTooltip' });
    _$hnNavPointsTooltipDiv.css({ visibility: 'hidden' });
    _$hnNavPointsTooltipDiv.html('');
    _popup = { segmentId: -1, hnNumber: -1, inUse: false };
}

function hideTooltipDelay(evt) {
    if (!evt)
        return;
    checkTimeout({ timeout: 'hideTooltip' });
    const parentsArr = (evt.toElement && evt.toElement.offsetParent) ? [evt.toElement.offsetParent, evt.toElement.offsetParent.offSetParent] : [];
    if (evt.toElement && ((parentsArr.indexOf(_HNNavPointsNumbersLayer.div) > -1) || (parentsArr.indexOf(_$hnNavPointsTooltipDiv[0]) > -1)))
        return;
    _timeouts.hideTooltip = window.setTimeout(hideTooltip, 100, evt);
}

function checkTooltip() {
    checkTimeout({ timeout: 'hideTooltip' });
}

function checkLayerIndex() {
    const layerIdx = W.map.layers.map(a => a.uniqueName).indexOf('__HNNavPointsNumbersLayer');
    let properIdx;
    if (_settings.keepHNLayerOnTop) {
        const layersIndexes = [],
            layersLoaded = W.map.layers.map(a => a.uniqueName);
        ['wmeGISLayersDefault', '__HNNavPointsLayer'].forEach(layerUniqueName => {
            if (layersLoaded.indexOf(layerUniqueName) > 0)
                layersIndexes.push(layersLoaded.indexOf(layerUniqueName));
        });
        properIdx = (Math.max(...layersIndexes) + 1);
    }
    else {
        properIdx = (W.map.layers.map(a => a.uniqueName).indexOf('__HNNavPointsLayer') + 1);
    }
    if (layerIdx !== properIdx) {
        W.map.layers.splice(properIdx, 0, W.map.layers.splice(layerIdx, 1)[0]);
        W.map.getOLMap().resetLayersZIndex();
    }
}

async function init() {
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
                label: '${hn_number}',
                fontSize: '12px',
                fontFamily: 'Rubik, Boing-light, sans-serif;',
                fontWeight: 'bold',
                direction: '${textDir}',
                labelOutlineColor: '${Color}',
                labelOutlineWidth: 3,
                labelSelect: true
            })
        })
    };
    log('Initializing.');
    await loadSettingsFromStorage();
    WazeWrap.Interface.AddLayerCheckbox('display', 'HN NavPoints', _settings.hnLines, hnLayerToggled);
    WazeWrap.Interface.AddLayerCheckbox('display', 'HN NavPoints Numbers', _settings.hnNumbers, hnNumbersLayerToggled);

    _HNNavPointsLayer = new OpenLayers.Layer.Vector('HN NavPoints Layer', {
        displayInLayerSwitcher: true,
        uniqueName: '__HNNavPointsLayer'
    });
    _HNNavPointsNumbersLayer = _settings.enableTooltip
        ? new OpenLayers.Layer.Markers('HN NavPoints Numbers Layer', navPointsNumbersLayersOptions)
        : new OpenLayers.Layer.Vector('HN NavPoints Numbers Layer', navPointsNumbersLayersOptions);
    W.map.addLayers([_HNNavPointsLayer, _HNNavPointsNumbersLayer]);
    _HNNavPointsLayer.setVisibility(_settings.hnLines);
    _HNNavPointsNumbersLayer.setVisibility(_settings.hnNumbers);
    /* 2020.07.16.01 - See note at top
    _hnMouseoverCtrl = new OpenLayers.Control.SelectFeature(_HNNavPointsNumbersLayer, {
        hover: true,
        highlightOnly: true,
        renderIntent: 'temporary',
        eventListeners: {
            featurehighlighted: showTooltip,
            featureunhighlighted: hideTooltipDelay
        }
    });
    W.map.addControl(_hnMouseoverCtrl);
    if (_settings.enableTooltip)
        _hnMouseoverCtrl.activate();
    */
    window.addEventListener('beforeunload', () => { checkShortcutsChanged(); }, false);
    new WazeWrap.Interface.Shortcut(
        'toggleHNNavPointsShortcut',
        'Toggle HN NavPoints layer',
        'layers',
        'layersToggleHNNavPoints',
        _settings.toggleHNNavPointsShortcut,
        () => { $('#layer-switcher-item_hn_navpoints').click(); },
        null
    ).add();
    new WazeWrap.Interface.Shortcut(
        'toggleHNNavPointsNumbersShortcut',
        'Toggle HN NavPoints Numbers layer',
        'layers',
        'layersToggleHNNavPointsNumbers',
        _settings.toggleHNNavPointsNumbersShortcut,
        () => { $('#layer-switcher-item_hn_navpoints_numbers').click(); },
        null
    ).add();
    $('#sidepanel-prefs').append(() => {
        let htmlOut = '<div style="border-bottom:1px solid black; padding-bottom:10px;';
        if ($('#sidepanel-prefs')[0].lastChild.tagName.search(/HR/gi) > -1) {
            const elmnt = $('#sidepanel-prefs')[0].lastChild;
            elmnt.style.borderTopColor = 'black';
            elmnt.style.color = 'black';
        }
        else {
            htmlOut += 'border-top:1px solid black;';
        }
        htmlOut += '"><h4>WME HN NavPoints</h4>'
            + '<div style="font-size:12px; margin-left:6px;">'
            + '<div style="margin-bottom:5px;" title="Disable NavPoints and house numbers when zoom level is less than specified number.\r\nMinimum: 18\r\nDefault: 17">'
            + `Disable when zoom level <<input type="text" id="HNNavPoints_disableBelowZoom" style="width:24px; height:20px; margin-left:4px;" value="${_settings.disableBelowZoom}"></input></div>`
            + `<input type="checkbox" style="margin-top:1px;" id="HNNavPoints_cbenableTooltip" title="Enable tooltip when mousing over house numbers."${(_settings.enableTooltip ? ' checked' : '')}>`
            + '     <label for="HNNavPoints_cbenableTooltip" style="font-weight:normal; vertical-align:top"'
            + '         title="Enable tooltip when mousing over house numbers.\r\nWarning: This may cause performance issues.">Enable tooltip</label><br>'
            + '<input type="checkbox" style="margin-top:1px;" id="HNNavPoints_cbkeepHNLayerOnTop" '
            + `title="Keep house numbers layer on top of all other layers."${(_settings.keepHNLayerOnTop ? ' checked' : '')}>`
            + '     <label for="HNNavPoints_cbenableTooltip" style="font-weight:normal; vertical-align:top" title="Keep house numbers layer on top of all other layers.">Keep HN layer on top</label>'
            + '</div>'
            + '<div style="margin:0 10px 0 10px; width:130px; text-align:center; font-size:12px; background:black; font-weight:600;">'
            + ' <div style="text-shadow:0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white,0 0 3px white;">Touched</div>'
            + ' <div style="text-shadow:0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange,0 0 3px orange;'
            + '     ">Touched forced</div>'
            + ' <div style="text-shadow:0 0 3px yellow,0 0 3px yellow,0 0 3px yellow, 0 0 3px yellow,0 0 3px yellow,0 0 3px yellow,0 0 3px yellow,0 0 3px yellow,0 0 3px yellow,0 0 3px yellow;'
            + '     ">Untouched</div>'
            + ' <div style="text-shadow:0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red,0 0 3px red;">Untouched forced</div>'
            + '</div></div>';
        return htmlOut;
    });
    $('#HNNavPoints_disableBelowZoom').on('change', function () {
        const newVal = Math.max(16, Math.min(22, parseInt(this.value)));
        if ((newVal !== _settings.disableBelowZoom) || (this.value !== newVal)) {
            if (newVal !== parseInt(this.value))
                this.value = newVal;
            _settings.disableBelowZoom = newVal;
            saveSettingsToStorage();
            if ((W.map.getZoom() < newVal) && (_settings.hnLines || _settings.hnNumbers))
                processSegs('settingChanged', null, true, 0);
            else if (_settings.hnLines || _settings.hnNumbers)
                processSegs('settingChanged', W.model.segments.getByAttributes({ hasHNs: true }), true, 0);
        }
    });
    $('input[id^="HNNavPoints_cb"]').off().on('click', function () {
        const settingName = $(this)[0].id.substr(14);
        if (settingName === 'enableTooltip') {
            if (!this.checked)
                _HNNavPointsNumbersLayer.clearMarkers();
            else
                _HNNavPointsNumbersLayer.destroyFeatures();
            W.map.removeLayer(_HNNavPointsNumbersLayer);
            if (this.checked)
                _HNNavPointsNumbersLayer = new OpenLayers.Layer.Markers('HN NavPoints Numbers Layer', navPointsNumbersLayersOptions);
            else
                _HNNavPointsNumbersLayer = new OpenLayers.Layer.Vector('HN NavPoints Numbers Layer', navPointsNumbersLayersOptions);
            W.map.addLayer(_HNNavPointsNumbersLayer);
            _HNNavPointsNumbersLayer.setVisibility(_settings.hnNumbers);
        }
        _settings[settingName] = this.checked;
        if (settingName === 'keepHNLayerOnTop')
            checkLayerIndex();
        saveSettingsToStorage();
        if ((settingName === 'enableTooltip') && (W.map.getZoom() > (_settings.disableBelowZoom - 1)) && (_settings.hnLines || _settings.hnNumbers))
            processSegs('settingChanged', W.model.segments.getByAttributes({ hasHNs: true }), true, 0);
    });
    if (!_$hnNavPointsTooltipDiv) {
        $('#map').append(
            '<div id="hnNavPointsTooltipDiv" class="tippy-popper" role="tooltip" x-placement="top" style="z-index:9999; transition-duration:0ms; position:absolute;'
            + 'will-change:transform; top:0px; left:0px; visibility:none;"></div>'
        );
        _$hnNavPointsTooltipDiv = $('#hnNavPointsTooltipDiv');
        _$hnNavPointsTooltipDiv.on('mouseleave', null, hideTooltipDelay);
        _$hnNavPointsTooltipDiv.on('mouseenter', null, checkTooltip);
    }
    await initBackgroundTasks('enable');
    checkLayerIndex();
    log(`Fully initialized in ${Math.round(performance.now() - LOAD_BEGIN_TIME)} ms.`);
    showScriptInfoAlert();
    if (_scriptActive)
        processSegs('init', W.model.segments.getByAttributes({ hasHNs: true }));
    setTimeout(checkShortcutsChanged, 10000);
}

function bootstrap(tries) {
    if (W && W.map && W.model && $ && WazeWrap.Ready) {
        checkTimeout({ timeout: 'bootstrap' });
        log('Bootstrapping.');
        init();
    }
    else if (tries < 1000) {
        logDebug(`Bootstrap failed. Retrying ${tries} of 1000`);
        _timeouts.bootstrap = window.setTimeout(bootstrap, 200, ++tries);
    }
    else {
        logError('Bootstrap timed out waiting for WME to become ready.');
    }
}

bootstrap(1);
