/* eslint-disable no-template-curly-in-string */
// ==UserScript==
// @name            WME HN NavPoints (beta)
// @namespace       https://greasyfork.org/users/166843
// @description     Shows navigation points of all house numbers in WME
// @version         2020.06.09.03
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
    DEBUG = true,
    LOAD_BEGIN_TIME = performance.now(),
    SCRIPT_FORUM_URL = 'https://www.waze.com/forum/viewtopic.php?f=819&t=289116',
    SCRIPT_GF_URL = 'https://greasyfork.org/en/scripts/390565-wme-hn-navpoints',
    SCRIPT_NAME = GM_info.script.name.replace('(beta)', 'β'),
    SCRIPT_VERSION = GM_info.script.version,
    SCRIPT_VERSION_CHANGES = ['<b>NEW:</b> HN number mouseover tooltip (zooms 6-10). Edit button for easy HN mode access.',
        '<b>CHANGE:</b> Lots of under-the-hood stuff to increase performance.',
        '<b>CHANGE:</b> Latest WME update compatibility.',
        '<b>BUGFIX:</b> Reloads not properly refreshing HN and lines.'],
    SETTINGS_STORE_NAME = 'WMEHNNavPoints',
    _timeouts = {
        bootstrap: undefined,
        checkZIndex: undefined,
        hideTooltip: undefined,
        saveSettingsToStorage: undefined,
        setMarkerEvents: undefined
    };

let _settings = {},
    _scriptActive = false,
    _spinners = 0,
    _HNLayerObserver,
    _HNNavPointsLayer,
    _HNNavPointsNumbersLayer,
    _processedSegments = [],
    _segmentsToProcess = [],
    _$hnNavPointsTooltipDiv,
    _popup = {
        inUse: false,
        hnNumber: -1,
        streetId: -1
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
        _HNLayerObserver.observe($('div.olLayerDiv.house-numbers-layer')[0], { childList: false, subtree: true, attributes: true });
        _HNLayerObserver.observing = true;
    }
    else if (_HNLayerObserver.observing) {
        _HNLayerObserver.disconnect();
        _HNLayerObserver.observing = false;
    }
    setMarkersEvents();
}

function removeHNLines(hnObj) {
    if (!hnObj)
        return;
    const streetId = W.model.segments.getObjectById(hnObj.getSegmentId()).attributes.primaryStreetID,
        featureId = `HNNavPoints|${streetId}|${hnObj.getNumber()}|${hnObj.getSegmentId()}`,
        linesToRemove = _HNNavPointsLayer.getFeaturesByAttribute('featureId', featureId),
        markerIdx = _HNNavPointsNumbersLayer.markers.map(marker => marker.featureId).indexOf(featureId),
        hnToRemove = (markerIdx > -1) ? _HNNavPointsNumbersLayer.markers[markerIdx] : null;
    if (linesToRemove.length > 0) {
        _HNNavPointsLayer.removeFeatures(linesToRemove);
        if (hnToRemove)
            _HNNavPointsNumbersLayer.removeMarker(hnToRemove);
    }
    setMarkersEvents();
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
        destroyAllHNs();
        return;
    }
    if (evt.type === 'reloadData') {
        destroyAllHNs();
    }
    else if ((evt.length === 1) && (evt[0].type === 'houseNumber')) {
        if (_segmentsToProcess.indexOf(evt[0].getSegmentId()) === -1)
            _segmentsToProcess.push(evt[0].getSegmentId());
    }
    else if (evt.type === 'zoomend') {
        if ((W.map.getOLMap().getZoom() < _settings.disableBelowZoom))
            destroyAllHNs();
        if ((W.map.getOLMap().getZoom() > (_settings.disableBelowZoom - 1)) && (_processedSegments.length === 0))
            processSegs('zoomend', W.model.segments.getByAttributes({ hasHNs: true }), true);
    }
    else if (evt.action && ((evt.type === 'afterundoaction') || (evt.type === 'afteraction'))) {
        if (evt.action._description && (evt.action._description.indexOf('Deleted house number') > -1)) {
            if (evt.type === 'afterundoaction')
                drawHNLines([evt.action.object]);
            else
                removeHNLines(evt.action.object);
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
            removeHNLines(tempEvt.action.object);
            drawHNLines([evt.action.object]);
            setMarkersEvents();
        }
        else if (evt.action._description && (evt.action._description.indexOf('Added house number') > -1)) {
            if (evt.type === 'afterundoaction')
                removeHNLines(evt.action.houseNumber);
            else
                drawHNLines([evt.action.houseNumber]);
        }
        else if (evt.action._description && (evt.action._description.indexOf('Moved house number') > -1)) {
            drawHNLines([evt.action.newHouseNumber]);
        }
        else if (evt.action && evt.action.houseNumber) {
            drawHNLines((evt.action.newHouseNumber ? [evt.action.newHouseNumber] : [evt.action.houseNumber]));
            setMarkersEvents();
        }
    }
    else if (evt.type === 'click:input') {
        if (evt.object && evt.object.dragging && !evt.object.dragging.last)
            removeHNLines(evt.object.model);
    }
    else if (evt.type === 'delete') {
        removeHNLines(evt.object.model);
    }
}

function setMarkersEvents() {
    if (W.editingMediator.attributes.editingHouseNumbers) {
        checkTimeout({ timeout: 'setMarkerEvents' });
        hideTooltip();
        if (W.map.getOLMap().getLayersByName('houseNumberMarkers')[0].markers.length === 0) {
            _timeouts.setMarkerEvents = window.setTimeout(setMarkersEvents, 50);
            return;
        }
        W.map.getOLMap().getLayersByName('houseNumberMarkers')[0].markers.forEach(marker => {
            marker.events.unregister('click:input', null, processEvent);
            marker.events.unregister('delete', null, processEvent);
            marker.events.on({ 'click:input': processEvent, delete: processEvent });
        });
    }
    else if (W.map.getOLMap().getLayersByName('houseNumberMarkers').length > 0) {
        W.map.getOLMap().getLayersByName('houseNumberMarkers')[0].markers.forEach(marker => {
            marker.events.unregister('click:input', null, processEvent);
            marker.events.unregister('delete', null, processEvent);
        });
        processSegs('exithousenumbers', W.model.segments.getByIds(_segmentsToProcess), true);
        _segmentsToProcess = [];
        _HNNavPointsLayer.setZIndex(1000);
        _HNNavPointsNumbersLayer.setZIndex(1000);
    }
}

function drawHNLines(houseNumberArr) {
    if (houseNumberArr.length === 0)
        return;
    const lineFeatures = [],
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
        svgText = document.createElementNS('http://www.w3.org/2000/svg', 'text'),
        invokeTooltip = evt => { showTooltip(evt); };
    svg.setAttribute('xlink', 'http://www.w3.org/1999/xlink');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '0 0 40 10');
    svgText.setAttribute('text-anchor', 'middle');
    svgText.setAttribute('x', '50%');
    svgText.setAttribute('y', '70%');
    for (let i = 0; i < houseNumberArr.length; i++) {
        const hnObj = houseNumberArr[i],
            seg = W.model.segments.objects[hnObj.getSegmentId()];
        if (seg) {
            const streetId = seg.attributes.primaryStreetID,
                featureId = `HNNavPoints|${streetId}|${hnObj.getNumber()}|${hnObj.getSegmentId()}`,
                markerIdx = _HNNavPointsNumbersLayer.markers.map(marker => marker.featureId).indexOf(featureId),
                hnToRemove = (markerIdx > -1) ? _HNNavPointsNumbersLayer.markers[markerIdx] : null;
            if (hnToRemove)
                _HNNavPointsNumbersLayer.removeMarker(hnToRemove);
            _HNNavPointsLayer.removeFeatures(_HNNavPointsLayer.getFeaturesByAttribute('featureId', featureId));
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
                    { streetId, segmentId: hnObj.getSegmentId(), featureId },
                    {
                        strokeWidth: 4, strokeColor: 'black', strokeOpacity: 0.5, strokeDashstyle: 'dash', strokeDashArray: '8, 8'
                    }
                );
            lineFeatures.push(lineFeature);
            lineString = new OpenLayers.Geometry.LineString([p1, p2]);
            lineFeature = new OpenLayers.Feature.Vector(
                lineString,
                { streetId, segmentId: hnObj.getSegmentId(), featureId },
                {
                    strokeWidth: 2, strokeColor, strokeOpacity: 1, strokeDashstyle: 'dash', strokeDashArray: '8, 8'
                }
            );
            lineFeatures.push(lineFeature);
            svg.setAttribute('style', `text-shadow:0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor},0 0 3px ${strokeColor};font-size:12px;font-weight:bold;font-family:Arial Black, monospace;`);
            svgText.textContent = hnObj.getNumber();
            svg.innerHTML = svgText.outerHTML;
            const svgIcon = new OpenLayers.Icon(`data:image/svg+xml,${svg.outerHTML}`, { w: 40, h: 15 }),
                markerFeature = new OpenLayers.Marker(new OpenLayers.LonLat(p2.x, p2.y), svgIcon);
            markerFeature.events.register('mouseover', null, invokeTooltip);
            markerFeature.events.register('mouseout', null, hideTooltipDelay);
            markerFeature.featureId = featureId;
            markerFeature.segmentId = hnObj.getSegmentId();
            _HNNavPointsNumbersLayer.addMarker(markerFeature);
        }
    }
    if (lineFeatures.length > 0)
        _HNNavPointsLayer.addFeatures(lineFeatures);
}

function destroyAllHNs() {
    _HNNavPointsLayer.destroyFeatures();
    _HNNavPointsNumbersLayer.clearMarkers();
    _processedSegments = [];
    return Promise.resolve();
}

async function processSegs(action, arrSegObjs, processAll = false, retry = 0) {
    /* As of 2020.06.08 (sometime before this date) updatedOn does not get updated when updating house numbers. Looking for a new
     * way to track which segments have been updated most recently to prevent a total refresh of HNs after an event.
     * Changed to using a global to keep track of segmentIds touched during HN edit mode.
     */
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
    const eg = W.map.getOLMap().getExtent().toGeometry(),
        findObjIndex = (array, fldName, value) => array.map(a => a[fldName]).indexOf(value),
        processError = (err, chunk) => {
            logDebug(`Retry: ${retry}`);
            if (retry < 5)
                processSegs(action, chunk, true, ++retry);
            else
                logError(`Get HNs for ${chunk.length} segments failed. Code: ${err.status} - Text: ${err.responseText}`);
        };
    if (action === 'objectsremoved') {
        if (arrSegObjs && (arrSegObjs.length > 0)) {
            arrSegObjs.forEach(segObj => {
                if (!eg.intersects(segObj.geometry)) {
                    _HNNavPointsLayer.removeFeatures(_HNNavPointsLayer.getFeaturesByAttribute('segmentId', segObj.getID()));
                    _HNNavPointsNumbersLayer.markers.forEach(marker => {
                        if (marker.segmentId === segObj.getID())
                            _HNNavPointsNumbersLayer.removeMarker(marker);
                    });
                    const segIdx = findObjIndex(_processedSegments, 'segId', segObj.getID());
                    if (segIdx > -1)
                        _processedSegments.splice(segIdx, 1);
                }
            });
        }
    }
    else { // action = 'objectsadded', 'zoomend', 'init', 'exithousenumbers', 'hnLayerToggled', 'hnNumbersLayerToggled', 'settingChanged'
        let i = arrSegObjs.length,
            hnObjs = [];
        while (i--) {
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
                jsonData = await W.controller.descartesClient.getHouseNumbers(chunk.map(segObj => segObj.getID()));
            }
            catch (error) {
                processError(error, [...chunk]);
            }
            if (jsonData && (jsonData.error === undefined) && (typeof jsonData.segmentHouseNumbers.objects !== 'undefined'))
                hnObjs = hnObjs.concat(jsonData.segmentHouseNumbers.objects);
        }
        if (hnObjs.length > 0)
            drawHNLines(hnObjs);
    }
    doSpinner(true);
}

function segmentsEvent(objSegs) {
    processSegs('objectsadded', objSegs.filter(seg => seg.attributes.hasHNs));
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
        W.accelerators.events.on({ reloadData: processEvent });
        $('#overlay-buttons div.reload-button-region').on('click', null, destroyAllHNs);
        W.model.segments.on({ objectsadded: segmentsEvent, objectsremoved: segmentsEvent });
        W.model.segmentHouseNumbers.on({
            objectsadded: processEvent,
            objectsremoved: processEvent,
            objectschanged: processEvent,
            'objectschanged-id': processEvent,
            'objects-state-deleted': processEvent
        });
        W.editingMediator.on({ 'change:editingHouseNumbers': observeHNLayer });
        W.map.events.on({ zoomend: processEvent });
        WazeWrap.Events.register('afterundoaction', this, processEvent);
        WazeWrap.Events.register('afteraction', this, processEvent);
        _timeouts.checkZIndex = window.setInterval(() => {
            if (`${_HNNavPointsNumbersLayer.div.style.zIndex}` !== '1000')
                _HNNavPointsNumbersLayer.setZIndex(1000);
        }, 1000);
        _scriptActive = true;
    }
    else if (status === 'disable') {
        _HNLayerObserver = undefined;
        W.accelerators.events.on('reloadData', null, processEvent);
        $('#overlay-buttons div.reload-button-region').off('click', null, destroyAllHNs);
        W.model.segments.off({ objectsadded: segmentsEvent, objectsremoved: segmentsEvent });
        W.model.segmentHouseNumbers.off({
            objectsadded: processEvent,
            objectsremoved: processEvent,
            objectschanged: processEvent,
            'objectschanged-id': processEvent,
            'objects-state-deleted': processEvent
        });
        W.editingMediator.off({ 'change:editingHouseNumbers': observeHNLayer });
        W.map.events.unregister('zoomend', null, processEvent);
        WazeWrap.Events.unregister('afterundoaction', this, processEvent);
        WazeWrap.Events.unregister('afteraction', this, processEvent);
        window.clearInterval(_timeouts.checkZIndex);
        _timeouts.checkZIndex = undefined;
        _scriptActive = false;
    }
    return Promise.resolve();
}

function enterHNEditMode(evt) {
    if (evt && evt.data && evt.data.segment) {
        if (evt.data.moveMap)
            W.map.setCenter(new OpenLayers.LonLat(evt.data.segment.getCenter().x, evt.data.segment.getCenter().y), W.map.getOLMap().getZoom());
        W.selectionManager.setSelectedModels(evt.data.segment);
        $('#segment-edit-general .edit-house-numbers').click();
    }
}

function showTooltip(evt) {
    if ((W.map.getOLMap().getZoom() < 6) || (W.map.getOLMap().getLayersByName('houseNumberMarkers').length > 0))
        return;
    if (evt && evt.object && evt.object.featureId) {
        checkTooltip();
        const featureArr = evt.object.featureId.split('|'),
            streetId = featureArr[1],
            hnNumber = featureArr[2],
            segmentId = featureArr[3];
        if (_popup.inUse && (_popup.hnNumber === hnNumber) && (_popup.streetId === streetId))
            return;
        const street = W.model.streets.getObjectById(streetId),
            segment = W.model.segments.getObjectById(segmentId),
            popupPixel = W.map.getOLMap().getPixelFromLonLat(evt.object.lonlat),
            htmlOut = ''
                + '<div class="tippy-tooltip light-border-theme" id="hnNavPointsTooltipDiv-tooltip" data-size="large" data-animation="shift-away" data-state="visible"'
                + '     data-interactive="" style="transition-duration:325ms; top:0px;">'
                + ' <div class="tippy-arrow" id="hnNavPointsTooltipDiv-arrow" style="left:83px;"></div>'
                + ' <div class="tippy-content" id="hnNavPointsTooltipDiv-content" data-state="visible" style="transition-duration: 325ms;">'
                + '     <div>'
                + '         <div class="house-number-marker-tooltip">'
                + `             <div class="title">${(hnNumber > 0 ? `${hnNumber} ` : '')}${(street ? street.name : '')}</div>`
                + '             <div class="edit-button fa fa-pencil" id="hnNavPointsTooltipDiv-edit"></div>'
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
        _popup = { streetId, hn_number: hnNumber, inUse: true };
    }
}

function hideTooltip() {
    checkTimeout({ timeout: 'hideTooltip' });
    _$hnNavPointsTooltipDiv.css({ visibility: 'hidden' });
    _$hnNavPointsTooltipDiv.html('');
    _popup = { streetId: -1, hnNumber: -1, inUse: false };
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

function injectOLIcon() {
    logDebug('Injecting OpenLayers.Icon');
    // eslint-disable-next-line
    OpenLayers.Icon=OpenLayers.Class({url:null,size:null,offset:null,calculateOffset:null,imageDiv:null,px:null,initialize:function(a,b,c,d){this.url=a;this.size=b||{w:20,h:20};this.offset=c||{x:-(this.size.w/2),y:-(this.size.h/2)};this.calculateOffset=d;a=OL.Util.createUniqueID("OL_Icon_");this.imageDiv=OL.Util.createAlphaImageDiv(a)},destroy:function(){this.erase();OL.Event.stopObservingElement(this.imageDiv.firstChild);this.imageDiv.innerHTML="";this.imageDiv=null},clone:function(){returnnewOL.Icon(this.url,this.size,this.offset,this.calculateOffset)},setSize:function(a){null!=a&&(this.size=a);this.draw()},setUrl:function(a){null!=a&&(this.url=a);this.draw()},draw:function(a){OL.Util.modifyAlphaImageDiv(this.imageDiv,null,null,this.size,this.url,"absolute");this.moveTo(a);return this.imageDiv},erase:function(){null!=this.imageDiv&&null!=this.imageDiv.parentNode&&OL.Element.remove(this.imageDiv)},setOpacity:function(a){OL.Util.modifyAlphaImageDiv(this.imageDiv,null,null,null,null,null,null,null,a)},moveTo:function(a){null!=a&&(this.px=a);null!=this.imageDiv&&(null==this.px?this.display(!1):(this.calculateOffset&&(this.offset=this.calculateOffset(this.size)),OL.Util.modifyAlphaImageDiv(this.imageDiv,null,{x:this.px.x+this.offset.x,y:this.px.y+this.offset.y})))},display:function(a){this.imageDiv.style.display=a?"":"none"},isDrawn:function(){return this.imageDiv&&this.imageDiv.parentNode&&11!=this.imageDiv.parentNode.nodeType},CLASS_NAME:"OL.Icon"});
}

async function init() {
    log('Initializing.');
    await loadSettingsFromStorage();
    WazeWrap.Interface.AddLayerCheckbox('display', 'HN NavPoints', _settings.hnLines, hnLayerToggled);
    WazeWrap.Interface.AddLayerCheckbox('display', 'HN NavPoints Numbers', _settings.hnNumbers, hnNumbersLayerToggled);

    _HNNavPointsLayer = new OpenLayers.Layer.Vector('HN NavPoints Layer', {
        displayInLayerSwitcher: true,
        uniqueName: '__HNNavPointsLayer'
    });
    _HNNavPointsNumbersLayer = new OpenLayers.Layer.Markers('HN NavPoints Numbers Layer', {
        displayInLayerSwitcher: true,
        uniqueName: '__HNNavPointsNumbersLayer'
    });
    if (!OpenLayers.Icon)
        injectOLIcon();
    W.map.getOLMap().addLayer(_HNNavPointsLayer);
    W.map.getOLMap().addLayer(_HNNavPointsNumbersLayer);
    _HNNavPointsLayer.setVisibility(_settings.hnLines);
    _HNNavPointsNumbersLayer.setVisibility(_settings.hnNumbers);
    _HNNavPointsLayer.setZIndex(500);
    _HNNavPointsNumbersLayer.setZIndex(500);
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
                processSegs('settingChanged', W.model.segments.getByAttributes({ hasHNs: true }), true, 0);
        }
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
