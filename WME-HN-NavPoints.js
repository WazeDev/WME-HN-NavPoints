/* eslint-disable no-template-curly-in-string */
// ==UserScript==
// @name            WME HN NavPoints
// @namespace       https://greasyfork.org/users/166843
// @description     Shows navigation points of all house numbers in WME
// @version         2019.12.06.01
// @author          dBsooner
// @grant           none
// @require         https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @license         GPLv3
// @include         /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @contributionURL https://github.com/WazeDev/Thank-The-Authors
// ==/UserScript==

/* global _, $, document, GM_info, localStorage, MutationObserver, OL, performance, W, WazeWrap, window */

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
    SCRIPT_VERSION_CHANGES = ['<b>CHANGE:</b> WME v2.43-40-gf367bffa4 compatibility.'],
    SETTINGS_STORE_NAME = 'WMEHNNavPoints',
    _timeouts = {
        bootstrap: undefined,
        observeDragging: {},
        saveSettingsToStorage: undefined,
        setMarkerEvents: undefined
    };

let _settings = {},
    _scriptActive = false,
    _spinners = 0,
    _epsg900913,
    _epsg4326,
    _HNLayerObserver,
    _HNNavPointsLayer,
    _HNNavPointsNumbersLayer,
    _processedSegments = [];

function log(message) { console.log('WME-HN-NavPoints:', message); }
function logError(message) { console.error('WME-HN-NavPoints:', message); }
// function logWarning(message) { console.warn('WME-HN-NavPoints:', message); }
function logDebug(message) {
    if (DEBUG)
        console.log('WME-HN-NavPoints:', message);
}

async function loadSettingsFromStorage() {
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

function doSpinner(stop = false) {
    const $btn = $('#hnNPSpinner');
    if (stop) {
        _spinners--;
        if (_spinners === 0) {
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
        return;
    }
    _spinners++;
    if ($btn.length === 0) {
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


async function hnLayerToggled(checked) {
    _HNNavPointsLayer.setVisibility(checked);
    _settings.hnLines = checked;
    saveSettingsToStorage();
    if (checked) {
        if (!_scriptActive)
            await initBackgroundTasks('enable');
        processSegs('hnLayerToggled', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs));
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
        processSegs('hnNumbersLayerToggled', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs));
    }
    else if (!_settings.hnLines && _scriptActive) {
        initBackgroundTasks('disable');
    }
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

function observeDragging(marker, toIndex) {
    checkTimeout({ timeout: 'observeDragging', toIndex });
    if (marker.dragging.active)
        _timeouts.observeDragging[toIndex] = window.setTimeout(observeDragging, 50, marker, toIndex);
    else if (marker.model.attributes.number !== '' && W.map.getOLMap().getLayersByName('houseNumberMarkers')[0].markers.includes(marker))
        drawHNLines('MODEL', [W.model.segmentHouseNumbers.objects[marker.model.attributes.id].attributes]);
}

function removeHNLines(featureId, marker, permanent) {
    const linesToRemove = _HNNavPointsLayer.getFeaturesByAttribute('featureId', featureId),
        hnToRemove = _HNNavPointsNumbersLayer.getFeaturesByAttribute('featureId', featureId);
    if (linesToRemove.length > 0) {
        _HNNavPointsLayer.removeFeatures(linesToRemove);
        _HNNavPointsNumbersLayer.removeFeatures(hnToRemove);
        if (!permanent)
            observeDragging(marker, getRandomId());
    }
    if (W.map.getOLMap().getLayersByName('houseNumberMarkers')[0].markers[0].events.listeners.delete.length < 2)
        setMarkersEvents();
}

function createFeatureId(type, data) {
    if (type === 'creation')
        return `HNNavPoints|${W.model.segments.objects[data.segID].attributes.primaryStreetID}|${data.number}|${data.id}`;
    if (type === 'marker')
        return `HNNavPoints|${W.model.segments.objects[data.model.attributes.segID].attributes.primaryStreetID}|${data.model.attributes.number}|${data.model.attributes.id}`;
    if (type === 'action') {
        if (data.action.object)
            return `HNNavPoints|${W.model.segments.objects[data.action.object.attributes.segID].attributes.primaryStreetID}|${data.action.object.attributes.number}|${data.action.object.attributes.id}`;
        if (data.action.houseNumber)
            return `HNNavPoints|${W.model.segments.objects[data.action.houseNumber.attributes.segID].attributes.primaryStreetID}|${data.action.houseNumber.attributes.number}|${data.action.houseNumber.attributes.id}`;
    }
    return false;
}

function processEvent(evt) {
    if (!evt)
        return;
    if (!_settings.hnLines && !_settings.hnNumbers) {
        if (_scriptActive)
            initBackgroundTasks('disable');
        return;
    }
    if (W.map.getOLMap().getZoom() < _settings.disableBelowZoom) {
        if (_processedSegments.length > 0)
            destroyAllHNs();
        return;
    }
    if (evt.type === 'reloadData') {
        destroyAllHNs();
    }
    else if ((evt.type === 'zoomend') || (evt.type === 'moveend')) {
        processSegs(evt.type, W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs));
    }
    else if (evt.type === 'afterclearactions') {
        processSegs('exithousenumbers', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs), (W.editingMediator.attributes.editingHouseNumbers));
    }
    else if (evt.type === 'noActions') {
        processSegs('exithousenumbers', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs), false);
    }
    else if (evt.action && ((evt.type === 'afterundoaction') || (evt.type === 'afteraction'))) {
        if (evt.action._description && (evt.action._description.indexOf('Deleted house number') > -1)) {
            if (evt.type === 'afterundoaction')
                drawHNLines('MODEL', [evt.action.object.attributes]);
            else
                removeHNLines(createFeatureId('action', evt), null, true);
                // markerRemoveLine(evt);
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
            removeHNLines(createFeatureId('action', tempEvt), null, true); // markerRemoveLine(tempEvt);
            drawHNLines('MODEL', [evt.action.attributes]);
            setMarkersEvents();
        }
        else if (evt.action._description && (evt.action._description.indexOf('Added house number') > -1)) {
            if (evt.type === 'afterundoaction')
                removeHNLines(createFeatureId('action', evt), null, true); // markerRemoveLine(evt);
            else
                drawHNLines('MODEL', [evt.action.houseNumber.attributes]);
        }
        else if (evt.action && evt.action.houseNumber) {
            drawHNLines('MODEL', (evt.action.newHouseNumber ? [evt.action.newHouseNumber.attributes] : [evt.action.houseNumber.attributes]));
            setMarkersEvents();
        }
    }
    else if (evt.type === 'click:input') {
        if (evt.object && evt.object.dragging && !evt.object.dragging.last)
            removeHNLines(createFeatureId('marker', evt.object), evt.object, false);
    }
    else if (evt.type === 'delete') {
        removeHNLines(createFeatureId('marker', evt.object), evt.object, true);
    }
}

function setMarkersEvents() {
    if (W.editingMediator.attributes.editingHouseNumbers) {
        checkTimeout({ timeout: 'setMarkerEvents' });
        if (W.map.getOLMap().getLayersByName('houseNumberMarkers')[0].markers.length === 0) {
            _timeouts.setMarkerEvents = window.setTimeout(setMarkersEvents, 50);
            return;
        }
        W.map.getOLMap().getLayersByName('houseNumberMarkers')[0].markers.forEach(marker => {
            marker.events.unregister('click:input', null, processEvent);
            marker.events.unregister('delete', null, processEvent);
            marker.events.register('click:input', null, processEvent);
            marker.events.register('delete', null, processEvent);
        });
    }
    else if (W.map.getOLMap().getLayersByName('houseNumberMarkers').length > 0) {
        W.map.getOLMap().getLayersByName('houseNumberMarkers')[0].markers.forEach(marker => {
            marker.events.unregister('click:input', null, processEvent);
            marker.events.unregister('delete', null, processEvent);
        });
        processSegs('exithousenumbers', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs), true);
    }
}

function drawHNLines(type, houseNumberArr) {
    if (houseNumberArr.length === 0)
        return;
    const lineFeatures = [],
        numberFeatures = [];
    for (let i = 0; i < houseNumberArr.length; i++) {
        const houseNumber = houseNumberArr[i],
            seg = W.model.segments.objects[houseNumber.segID];
        if (seg) {
            const streetId = seg.attributes.primaryStreetID,
                featureId = createFeatureId('creation', houseNumber);
            _HNNavPointsLayer.removeFeatures(_HNNavPointsLayer.getFeaturesByAttribute('featureId', featureId));
            _HNNavPointsNumbersLayer.removeFeatures(_HNNavPointsNumbersLayer.getFeaturesByAttribute('featureId', featureId));
            const p1 = (type === 'JSON')
                    ? new OL.Geometry.Point(houseNumber.fractionPoint.coordinates[0], houseNumber.fractionPoint.coordinates[1]).transform(_epsg4326, _epsg900913)
                    : new OL.Geometry.Point(houseNumber.fractionPoint.x, houseNumber.fractionPoint.y),
                p2 = (type === 'JSON')
                    ? new OL.Geometry.Point(houseNumber.geometry.coordinates[0], houseNumber.geometry.coordinates[1]).transform(_epsg4326, _epsg900913)
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
            lineFeatures.push(lineFeature);
            lineString = new OL.Geometry.LineString([p1, p2]);
            lineFeature = new OL.Feature.Vector(
                lineString,
                { streetId, segmentId: houseNumber.segID, featureId },
                {
                    strokeWidth: 2, strokeColor, strokeOpacity: 1, strokeDashstyle: 'dash', strokeDashArray: '8, 8'
                }
            );
            lineFeatures.push(lineFeature);
            // eslint-disable-next-line new-cap
            numberFeatures.push(new OL.Feature.Vector(new OL.Geometry.Polygon.createRegularPolygon(p2, 1, 20), {
                streetId, segmentId: houseNumber.segID, featureId, hn_number: houseNumber.number, strokeWidth: 3, Color: strokeColor
            }));
        }
    }
    if (lineFeatures.length > 0)
        _HNNavPointsLayer.addFeatures(lineFeatures);
    if (numberFeatures.length > 0)
        _HNNavPointsNumbersLayer.addFeatures(numberFeatures);
}

function destroyAllHNs() {
    return new Promise(resolve => {
        _HNNavPointsLayer.destroyFeatures();
        _HNNavPointsNumbersLayer.destroyFeatures();
        _processedSegments = [];
        resolve();
    });
}

async function processSegs(action, arrSegObjs, processAll = false, retry = 0) {
    if (!_settings.hnLines && !_settings.hnNumbers) {
        if (_scriptActive)
            initBackgroundTasks('disable');
        return;
    }
    if ((action === 'settingChanged') && (W.map.getOLMap().getZoom() < _settings.disableBelowZoom)) {
        doSpinner(false);
        await destroyAllHNs();
        doSpinner(true);
        return;
    }
    if (!arrSegObjs || (arrSegObjs.length === 0) || (W.map.getOLMap().getZoom() < _settings.disableBelowZoom))
        return;
    doSpinner(false);
    const findObjIndex = (array, fldName, value) => array.map(a => a[fldName]).indexOf(value),
        processError = (err, chunk) => {
            logDebug(`Retry: ${retry}`);
            if (retry < 5)
                processSegs(action, chunk, true, ++retry);
            else
                logError(`Get HNs for ${chunk.length} segments failed. Code: ${err.status} - Text: ${err.responseText}`);
        };
    if (action === 'objectsremoved') {
        if (arrSegObjs && (arrSegObjs.length > 0)) {
            const eg = W.map.getOLMap().getExtent().toGeometry();
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
    else { // action = 'zoomend', 'moveend', 'objectsadded' , 'init', 'exithousenumbers', 'hnLayerToggled', 'hnNumbersLayerToggled', 'settingChanged'
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
                processError(error, [...chunk]);
            }
            if (jsonData && (jsonData.error === undefined) && (typeof jsonData.segmentHouseNumbers.objects !== 'undefined'))
                drawHNLines('JSON', jsonData.segmentHouseNumbers.objects);
        }
    }
    doSpinner(true);
}

function segmentsEvent(objSegs) {
    processSegs('objectsadded', objSegs.filter(seg => seg.attributes.hasHNs));
}

function initBackgroundTasks(status) {
    return new Promise(resolve => {
        if (status === 'enable') {
            _HNLayerObserver = new MutationObserver(mutationsList => {
                mutationsList.forEach(() => {
                    const input = $('div.olLayerDiv.house-numbers-layer div.house-number div.content.active:not(".new") input.number');
                    if (input.val() === '')
                        input[0].addEventListener('change', setMarkersEvents);
                });
            });
            W.accelerators.events.register('reloadData', null, processEvent);
            W.model.segments.on('objectsadded', segmentsEvent);
            W.model.segments.on('objectsremoved', segmentsEvent);
            W.editingMediator.on('change:editingHouseNumbers', setMarkersEvents);
            W.editingMediator.on('change:editingHouseNumbers', observeHNLayer);
            WazeWrap.Events.register('zoomend', null, processEvent);
            WazeWrap.Events.register('moveend', null, processEvent);
            WazeWrap.Events.register('afterundoaction', this, processEvent);
            WazeWrap.Events.register('afteraction', this, processEvent);
            WazeWrap.Events.register('afterclearactions', this, processEvent);
            W.model.actionManager.events.register('noActions', null, processEvent);
            _scriptActive = true;
        }
        else if (status === 'disable') {
            _HNLayerObserver = undefined;
            W.accelerators.events.unregister('reloadData', null, processEvent);
            W.model.segments.off('objectsadded', segmentsEvent);
            W.model.segments.off('objectsremoved', segmentsEvent);
            W.editingMediator.off('change:editingHouseNumbers', setMarkersEvents);
            W.editingMediator.off('change:editingHouseNumbers', observeHNLayer);
            WazeWrap.Events.unregister('zoomend', null, processEvent);
            WazeWrap.Events.unregister('moveend', null, processEvent);
            WazeWrap.Events.unregister('afterundoaction', this, processEvent);
            WazeWrap.Events.unregister('afteraction', this, processEvent);
            WazeWrap.Events.unregister('afterclearactions', this, processEvent);
            W.model.actionManager.events.unregister('noActions', null, processEvent);
            _scriptActive = false;
        }
        resolve();
    });
}

async function init() {
    log('Initializing.');
    await loadSettingsFromStorage();
    WazeWrap.Interface.AddLayerCheckbox('display', 'HN NavPoints', _settings.hnLines, hnLayerToggled);
    WazeWrap.Interface.AddLayerCheckbox('display', 'HN NavPoints Numbers', _settings.hnNumbers, hnNumbersLayerToggled);
    _epsg900913 = new OL.Projection('EPSG:900913');
    _epsg4326 = new OL.Projection('EPSG:4326');
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
    W.map.getOLMap().addLayer(_HNNavPointsLayer);
    W.map.getOLMap().addLayer(_HNNavPointsNumbersLayer);
    _HNNavPointsLayer.setVisibility(_settings.hnLines);
    _HNNavPointsNumbersLayer.setVisibility(_settings.hnNumbers);
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
            + '<div style="font-size:12px; margin-left:6px;" title="Disable NavPoints and house numbers when zoom level is less than specified number.\r\nMinimum: 4\r\nDefault: 5">'
            + `Disable when zoom level <<input type="text" id="HNNavPoints_disableBelowZoom" style="width:24px; height:20px; margin-left:4px;" value="${_settings.disableBelowZoom}"></input>`
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
        const newVal = Math.min(10, Math.max(4, parseInt(this.value)));
        if (newVal !== _settings.disableBelowZoom) {
            if (newVal !== parseInt(this.value))
                this.value = newVal;
            _settings.disableBelowZoom = newVal;
            saveSettingsToStorage();
            if ((W.map.getOLMap().getZoom() < newVal) && (_settings.hnLines || _settings.hnNumbers))
                processSegs('settingChanged', null, true, 0);
            else if (_settings.hnLines || _settings.hnNumbers)
                processSegs('settingChanged', W.model.segments.getObjectArray().filter(seg => seg.attributes.hasHNs), true, 0);
        }
    });
    await initBackgroundTasks('enable');
    log(`Fully initialized in ${Math.round(performance.now() - LOAD_BEGIN_TIME)} ms.`);
    showScriptInfoAlert();
    if (_scriptActive)
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
