/* eslint-disable no-template-curly-in-string */
// ==UserScript==
// @name            WME HN NavPoints (beta)
// @namespace       https://greasyfork.org/users/166843
// @description     Shows navigation points of all house numbers in WME
// @version         2019.10.09.02
// @author          dBsooner
// @authorCZ        MajkiiTelini
// @grant           none
// @require         https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @license         GPLv3
// @include         /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @contributionURL https://github.com/WazeDev/Thank-The-Authors
// ==/UserScript==

/* global $, document, GM_info, localStorage, MutationObserver, OL, performance, W, WazeWrap, window */

/*
 * Original concept and code for WME HN NavPoints was written by MajkiiTelini. After version 0.6.6, this
 * script is maintained by the WazeDev team. Special thanks is definitely given to MajkiiTelini for his
 * hard work and dedication to the original script.
 *
 */

const ALERT_UPDATE = true,
    DEBUG = true,
    LOAD_BEGIN_TIME = performance.now(),
    SCRIPT_FORUM_URL = 'https://www.waze.com/forum/viewtopic.php?f=819&t=289116',
    SCRIPT_GF_URL = 'https://greasyfork.org/en/scripts/390565-wme-hn-navpoints',
    SCRIPT_NAME = GM_info.script.name.replace('(beta)', 'β'),
    SCRIPT_VERSION = GM_info.script.version,
    SCRIPT_VERSION_CHANGES = ['<b>NEW:</b> Initial WazeDev version release.',
        '<b>NEW:</b> Updated to utilize WazeWrap features.',
        '<b>NEW:</b> Settings saved to WazeWrap for easy access from other browsers.',
        '<b>NEW:</b> Disable when zoom level < # setting created. Set in WME Settings. (Minimum: 4)',
        '<b>CHANGE:</b> Lots of under the hood stuff to enhance experience.',
        '<b>BUGFIX:</b> Keyboard shortcuts to toggle layers now remembered.'
    ],
    SETTINGS_STORE_NAME = 'WMEHNNavPoints',
    _timeouts = {
        bootstrap: undefined,
        observeRemovedLine: {},
        saveSettingsToStorage: undefined,
        setMarkerEvents: undefined
    };

let _settings = {},
    _HNLayerObserver,
    _HNNavPointsLayer,
    _HNNavPointsNumbersLayer,
    _processedSegments = [];

function log(message) { console.log('WME-HN-NavPoints:', message); }
function logError(message) { console.error('WME-HN-NavPoints:', message); }
function logWarning(message) { console.warn('WME-HN-NavPoints:', message); }
function logDebug(message) {
    if (DEBUG)
        console.log('WME-HN-NavPoints:', message);
}

function loadSettingsFromStorage() {
    return new Promise(async resolve => {
        const defaultSettings = {
                disableBelowZoom: 5,
                hnLines: true,
                hnNumbers: true,
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
        _timeouts.saveSettingsToStorage = window.setTimeout(saveSettingsToStorage, 5000);
        resolve();
    });
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

function getRandomId() {
    return Math.random().toString(36).slice(2);
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

function hnLayerToggled(checked) {
    _HNNavPointsLayer.setVisibility(checked);
    _settings.hnLines = checked;
    saveSettingsToStorage();
    if (checked)
        processSegs('hnLayerToggled', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs));
}

function hnNumbersLayerToggled(checked) {
    _HNNavPointsNumbersLayer.setVisibility(checked);
    _settings.hnNumbers = checked;
    saveSettingsToStorage();
    if (checked)
        processSegs('hnNumbersLayerToggled', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs));
}

function observeHNLayer() {
    if (W.editingMediator.attributes.editingHouseNumbers && !_HNLayerObserver.observing) {
        _HNLayerObserver.observe($('div.olLayerDiv.house-numbers-layer')[0], { childList: false, subtree: true, attributes: true });
        _HNLayerObserver.observing = true;
    }
    else if (_HNLayerObserver.observing) {
        _HNLayerObserver.disconnect();
        _HNLayerObserver.observing = false;
    }
}

function observeRemovedLine(marker, toIndex) {
    checkTimeout({ timeout: 'observeRemovedLine', toIndex });
    if (marker.dragging.active)
        _timeouts.observeRemovedLine[toIndex] = window.setTimeout(observeRemovedLine, 50, marker, toIndex);
    else if (marker.model.attributes.number !== '' && W.map.getLayersByName('houseNumberMarkers')[0].markers.includes(marker))
        drawHNLine('MODEL', W.model.segmentHouseNumbers.objects[marker.model.attributes.id].attributes);
}

function markerRemoveLine(evt) {
    if (!evt)
        return;
    const permanent = (evt.type === 'delete'),
        marker = evt.object,
        HNtoRemove = `HNNavPoints|${W.model.segments.objects[marker.model.attributes.segID].attributes.primaryStreetID}|${marker.model.attributes.number}|${marker.model.attributes.id}`,
        linesToRemove = _HNNavPointsLayer.getFeaturesByAttribute('featureId', HNtoRemove),
        hnToRemove = _HNNavPointsNumbersLayer.getFeaturesByAttribute('featureId', HNtoRemove);
    if (linesToRemove.length > 0) {
        _HNNavPointsLayer.removeFeatures(linesToRemove);
        _HNNavPointsNumbersLayer.removeFeatures(hnToRemove);
        if (!permanent)
            observeRemovedLine(marker, getRandomId());
    }
    if (W.map.getLayersByName('houseNumberMarkers')[0].markers[0].events.listeners.delete.length < 2)
        setMarkersEvents();
}

function processEvent(evt) {
    if (!evt)
        return;
    if (W.map.getZoom() < _settings.disableBelowZoom) {
        if (_processedSegments.length > 0)
            destroyAllHNs();
        return;
    }
    if ((evt.type === 'zoomend') || (evt.type === 'moveend')) {
        processSegs(evt.type, W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs));
    }
    else if (evt.type === 'afterclearactions') {
        processSegs('exithousenumbers', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs), false);
    }
    else if (evt.type === 'noActions') {
        processSegs('exithousenumbers', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs), false);
    }
    else if (evt.type === 'afterundoaction' || evt.type === 'afteraction') {
        if (!evt.action || !evt.action.houseNumber)
            return;
        drawHNLine('MODEL', (evt.action.newHouseNumber ? evt.action.newHouseNumber.attributes : evt.action.houseNumber.attributes));
        setMarkersEvents();
    }
}

function setMarkersEvents() {
    if (W.editingMediator.attributes.editingHouseNumbers) {
        checkTimeout({ timeout: 'setMarkerEvents' });
        if (W.map.getLayersByName('houseNumberMarkers')[0].markers.length === 0) {
            _timeouts.setMarkerEvents = window.setTimeout(setMarkersEvents, 50);
            return;
        }
        W.map.getLayersByName('houseNumberMarkers')[0].markers.forEach(marker => {
            marker.events.unregister('click:input', null, markerRemoveLine);
            marker.events.unregister('delete', null, markerRemoveLine);
            marker.events.register('click:input', null, markerRemoveLine);
            marker.events.register('delete', null, markerRemoveLine);
        });
    }
    else if (W.map.getLayersByName('houseNumberMarkers').length > 0) {
        W.map.getLayersByName('houseNumberMarkers')[0].markers.forEach(marker => {
            marker.events.unregister('click:input', null, markerRemoveLine);
            marker.events.unregister('delete', null, markerRemoveLine);
        });
        processSegs('exithousenumbers', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs), true);
    }
}

function drawHNLine(type, houseNumber) {
    const seg = W.model.segments.objects[houseNumber.segID];
    if (seg) {
        const streetId = seg.attributes.primaryStreetID,
            featureId = `HNNavPoints|${streetId}|${houseNumber.number}|${houseNumber.id}`;
        _HNNavPointsLayer.removeFeatures(_HNNavPointsLayer.getFeaturesByAttribute('featureId', featureId));
        _HNNavPointsNumbersLayer.removeFeatures(_HNNavPointsNumbersLayer.getFeaturesByAttribute('featureId', featureId));
        const epsg900913 = new OL.Projection('EPSG:900913'),
            epsg4326 = new OL.Projection('EPSG:4326'),
            p1 = (type === 'JSON')
                ? new OL.Geometry.Point(houseNumber.fractionPoint.coordinates[0], houseNumber.fractionPoint.coordinates[1]).transform(epsg4326, epsg900913)
                : new OL.Geometry.Point(houseNumber.fractionPoint.x, houseNumber.fractionPoint.y),
            p2 = (type === 'JSON')
                ? new OL.Geometry.Point(houseNumber.geometry.coordinates[0], houseNumber.geometry.coordinates[1]).transform(epsg4326, epsg900913)
                : new OL.Geometry.Point(houseNumber.geometry.x, houseNumber.geometry.y),
            // eslint-disable-next-line no-nested-ternary
            strokeColor = (houseNumber.forced
                ? (!houseNumber.hasOwnProperty('updatedBy')) ? 'red' : 'orange'
                : (!houseNumber.hasOwnProperty('updatedBy')) ? 'yellow' : 'white'
            );
        let lineString = new OL.Geometry.LineString([p1, p2]),
            lineFeature = new OL.Feature.Vector(
                lineString,
                { streetId, segmentId: houseNumber.segID, featureId },
                {
                    strokeWidth: 4, strokeColor: 'black', strokeOpacity: 0.5, strokeDashstyle: 'dash', strokeDashArray: '8, 8'
                }
            );
        _HNNavPointsLayer.addFeatures(lineFeature);
        lineString = new OL.Geometry.LineString([p1, p2]);
        lineFeature = new OL.Feature.Vector(
            lineString,
            { streetId, segmentId: houseNumber.segID, featureId },
            {
                strokeWidth: 2, strokeColor, strokeOpacity: 1, strokeDashstyle: 'dash', strokeDashArray: '8, 8'
            }
        );
        _HNNavPointsLayer.addFeatures(lineFeature);
        // eslint-disable-next-line new-cap
        _HNNavPointsNumbersLayer.addFeatures(new OL.Feature.Vector(new OL.Geometry.Polygon.createRegularPolygon(p2, 1, 20), {
            streetId, segmentId: houseNumber.segID, featureId, hn_number: houseNumber.number, strokeWidth: 3, Color: strokeColor
        }));
    }
}

function destroyAllHNs() {
    _HNNavPointsLayer.destroyFeatures();
    _HNNavPointsNumbersLayer.destroyFeatures();
    _processedSegments = [];
}

async function processSegs(action, arrSegObjs, processAll = false, retry = 0) {
    if ((action === 'settingChanged') && (W.map.getZoom() < _settings.disableBelowZoom)) {
        destroyAllHNs();
        return;
    }
    if (!arrSegObjs || (arrSegObjs.length === 0) || (W.map.getZoom() < _settings.disableBelowZoom))
        return;
    const findObjIndex = (array, fldName, value) => array.map(a => a[fldName]).indexOf(value),
        processError = (err, chunk) => {
            // if (err.status === 414) {
            if (retry < 5)
                processSegs(action, chunk, true, ++retry);
            else
                logWarning(`Get HNs for ${chunk.length} segments failed. Code: ${err.status} - Text: ${err.responseText}`);
            // }
        };
    if (action === 'objectsremoved') {
        if (arrSegObjs && (arrSegObjs.length > 0)) {
            const eg = W.map.getExtent().toGeometry();
            arrSegObjs.forEach(segObj => {
                if (!eg.intersects(segObj.geometry)) {
                    _HNNavPointsLayer.removeFeatures(_HNNavPointsLayer.getFeaturesByAttribute('segmentId', segObj.attributes.id));
                    _HNNavPointsNumbersLayer.removeFeatures(_HNNavPointsNumbersLayer.getFeaturesByAttribute('segmentId', segObj.attributes.id));
                    const segIdx = findObjIndex(_processedSegments, 'segId', segObj.attributes.id);
                    if (segIdx > -1)
                        _processedSegments.splice(segIdx, 1);
                }
            });
        }
    }
    else { // action = 'zoomend', 'moveend', 'objectsadded' , 'init', 'exithousenumbers', hnLayerToggled, hnNumbersLayerToggled
        const descartesUrl = `${((document.URL.indexOf('https://beta.waze.com') > -1) ? 'https://beta.waze.com' : 'https://www.waze.com')}${W.Config.paths.houseNumbers}`;
        let i = arrSegObjs.length;
        while (i--) {
            const segIdx = findObjIndex(_processedSegments, 'segId', arrSegObjs[i].attributes.id);
            if (segIdx > -1) {
                if (arrSegObjs[i].attributes.updatedOn > _processedSegments[segIdx].updatedOn)
                    _processedSegments[segIdx].updatedOn = arrSegObjs[i].attributes.updatedOn;
                else if (!processAll)
                    arrSegObjs.splice(i, 1);
            }
            else {
                _processedSegments.push({ segId: arrSegObjs[i].attributes.id, updatedOn: arrSegObjs[i].attributes.updatedOn });
            }
        }
        while (arrSegObjs.length > 0) {
            let jsonData,
                chunk;
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
                jsonData = await $.ajax({
                    dataType: 'json',
                    url: descartesUrl,
                    data: { ids: chunk.map(segObj => segObj.attributes.id).join(',') }
                }).fail(response => { processError(response, [...chunk]); });
            }
            catch (error) {
                // if (error.status === 414)
                processError(error, [...chunk]);
            }
            if (jsonData && (jsonData.error === undefined) && (typeof jsonData.segmentHouseNumbers.objects !== 'undefined')) { // success(json) {
                for (let k = 0; k < jsonData.segmentHouseNumbers.objects.length; k++)
                    drawHNLine('JSON', jsonData.segmentHouseNumbers.objects[k]);
            }
        }
    }
}

async function init() {
    log('Initializing.');
    await loadSettingsFromStorage();
    _HNNavPointsLayer = new OL.Layer.Vector('HN NavPoints Layer', {
        displayInLayerSwitcher: true,
        uniqueName: '__HNNavPointsLayer'
    });
    _HNNavPointsNumbersLayer = new OL.Layer.Vector('HN NavPoints Numbers Layer', {
        displayInLayerSwitcher: true,
        uniqueName: '__HNNavPointsNumbersLayer',
        styleMap: new OL.StyleMap(
            {
                default: {
                    strokeColor: '${Color}',
                    strokeOpacity: 1,
                    strokeWidth: 3,
                    fillColor: '${Color}',
                    fillOpacity: 0.5,
                    pointerEvents: 'visiblePainted',
                    label: '${hn_number}',
                    fontSize: '12px',
                    fontFamily: 'Arial Black, monospace',
                    fontWeight: 'bold',
                    labelOutlineColor: '${Color}',
                    labelOutlineWidth: 3
                }
            }
        )
    });
    W.map.addLayer(_HNNavPointsLayer);
    W.map.addLayer(_HNNavPointsNumbersLayer);
    _HNNavPointsLayer.setVisibility(_settings.hnLines);
    _HNNavPointsNumbersLayer.setVisibility(_settings.hnNumbers);
    WazeWrap.Interface.AddLayerCheckbox('display', 'HN NavPoints', _settings.hnLines, hnLayerToggled);
    WazeWrap.Interface.AddLayerCheckbox('display', 'HN NavPoints Numbers', _settings.hnNumbers, hnNumbersLayerToggled);
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
        let htmlOut = '';
        if ($('#sidepanel-prefs')[0].lastChild.tagName.search(/HR/gi) > -1) {
            const elmnt = $('#sidepanel-prefs')[0].lastChild;
            elmnt.style.borderTopColor = 'black';
            elmnt.style.color = 'black';
            htmlOut += '<div>';
        }
        else {
            htmlOut += '<div style="border-top:1px solid black;">';
        }
        htmlOut += '<h4>WME HN NavPoints</h4>'
            + '<div style="font-size:12px; margin-left:22px;"'
            + 'title="Disable NavPoints and house numbers when zoom level is less than specified number. Minimum: 4.\r\nDefault: 5">'
            + `Disable when zoom level <<input type="text" id="HNNavPoints_disableBelowZoom" style="width:24px; height:20px; margin-left:4px;" value="${_settings.disableBelowZoom}"></input>`
            + '</div></div>';
        return htmlOut;
    });
    $('#HNNavPoints_disableBelowZoom').on('change', function () {
        const newVal = Math.min(10, Math.max(4, parseInt(this.value)));
        if (newVal !== _settings.disableBelowZoom) {
            if (newVal !== parseInt(this.value))
                this.value = newVal;
            _settings.disableBelowZoom = newVal;
            saveSettingsToStorage();
            processSegs();
        }
    });
    _HNLayerObserver = new MutationObserver(mutationsList => {
        mutationsList.forEach(() => {
            const input = $('div.olLayerDiv.house-numbers-layer div.house-number div.content.active:not(".new") input.number');
            if (input.val() === '')
                input[0].addEventListener('change', setMarkersEvents);
        });
    });
    W.accelerators.events.register('reloadData', null, () => {
        _HNNavPointsLayer.destroyFeatures();
        _HNNavPointsNumbersLayer.destroyFeatures();
        _processedSegments = [];
    });
    W.model.segments.on('objectsadded', objSegs => { processSegs('objectsadded', objSegs.filter(seg => seg.attributes.hasHNs)); });
    W.model.segments.on('objectsremoved', objSegs => { processSegs('objectsremoved', objSegs.filter(seg => seg.attributes.hasHNs)); });
    W.editingMediator.on('change:editingHouseNumbers', setMarkersEvents);
    W.editingMediator.on('change:editingHouseNumbers', observeHNLayer);
    WazeWrap.Events.register('zoomend', null, processEvent);
    WazeWrap.Events.register('moveend', null, processEvent);
    WazeWrap.Events.register('afterundoaction', this, processEvent);
    WazeWrap.Events.register('afteraction', this, processEvent);
    WazeWrap.Events.register('afterclearactions', this, processEvent);
    W.model.actionManager.events.register('noActions', null, processEvent);
    log(`Fully initialized in ${Math.round(performance.now() - LOAD_BEGIN_TIME)} ms.`);
    showScriptInfoAlert();
    processSegs('init', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs));
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
