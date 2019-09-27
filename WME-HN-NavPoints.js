// ==UserScript==
// @name            WME HN NavPoints
// @version			0.6.6
// @authorCZ		MajkiiTelini
// @description		Shows navigation points of all house numbers in WME
// @include			/^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor.*$/
// @run-at			document-end
// @namespace		https://greasyfork.org/cs/users/135686
// ==/UserScript==

var W = unsafeWindow.W;
var OL = unsafeWindow.OL;
var I18n = unsafeWindow.I18n;
var epsg900913 = new OL.Projection("EPSG:900913");
var epsg4326 = new OL.Projection("EPSG:4326");
var HNNavPointsLayer;
var HNNavPointsNumbersLayer;
var oldSegmentsId = [];
var lastDownloadTime = Date.now();
var layerTogglers = {};
const maxZoom = 5;

HNNavPoints_init();

function HNNavPoints_init(e) {
	if (e && e.user === null) {
		return;
	}
	if (typeof W === "undefined" || typeof W.loginManager === "undefined" || typeof W.map === "undefined" || typeof OL === "undefined" || document.querySelector(".list-unstyled.togglers .group") === null) {
		setTimeout(HNNavPoints_init, 100);
		return;
	}
	if (!W.loginManager.user) {
		W.loginManager.events.register("login", null, HNNavPoints_init);
		W.loginManager.events.register("loginStatus", null, HNNavPoints_init);
		if (!W.loginManager.user) {
			return;
		}
	}
	HNNavPointsLayer = new OL.Layer.Vector("HN NavPoints Layer", {
		displayInLayerSwitcher: true,
		uniqueName: "__HNNavPointsLayer"
	});
	HNNavPointsNumbersLayer = new OL.Layer.Vector("HN NavPoints Numbers Layer", {
		displayInLayerSwitcher: true,
		uniqueName: "__HNNavPointsNumbersLayer",
		styleMap: new OL.StyleMap({'default':{
			strokeColor: "${Color}",
			strokeOpacity: 1,
			strokeWidth: 3,
			fillColor: "${Color}",
			fillOpacity: 0.5,
			pointerEvents: "visiblePainted",
			label : "${hn_number}",
			fontSize: "12px",
			fontFamily: "Arial Black, monospace",
			fontWeight: "bold",
			labelOutlineColor: "${Color}",
			labelOutlineWidth: 3
		}})
	});
	var displayGroupSelector = document.getElementById("layer-switcher-group_display");
	if (displayGroupSelector !== null) {
		layerTogglers.hnLines = addLayerToggler(displayGroupSelector, HNNavPointsLayer, "hnLines", "HN NavPoints");
		layerTogglers.hnNumbers = addLayerToggler(displayGroupSelector, HNNavPointsNumbersLayer, "hnNumbers", "HN NavPoints Numbers");
	}
	W.map.addLayer(HNNavPointsLayer);
	W.map.addLayer(HNNavPointsNumbersLayer);
	function saveHNNavPointsOptions() {
		if (localStorage) {
			var options = {};
			for (var key in layerTogglers) {
				options[key] = document.getElementById(layerTogglers[key].htmlItem).checked;
			}
			localStorage.WMEHNNavPoints = JSON.stringify(options);
		}
	}
	window.addEventListener("beforeunload", saveHNNavPointsOptions, false);
	if (localStorage.WMEHNNavPoints) {
		var options = JSON.parse(localStorage.WMEHNNavPoints);
		for (var key in layerTogglers) {
			document.getElementById(layerTogglers[key].htmlItem).checked = options[key];
			layerTogglers[key].layer.setVisibility(options[key] & !document.getElementById(layerTogglers[key].htmlItem).disabled & W.map.zoom >= maxZoom);
		}
	}
	W.map.events.register("zoomend", null, requestHNs);
	W.map.events.register("moveend", null, requestHNs);
	W.model.events.register("mergeend", null, requestHNs);
	W.map.baseLayer.events.register("loadend", null, requestHNs);
	W.model.actionManager.events.register("afterclearactions", null, requestHNs);
	W.model.actionManager.events.register("afteraction", null, requestHNs);
	W.model.actionManager.events.register("afterundoaction", null, requestHNs);
	W.model.actionManager.events.register("afterundoaction", null, setMarkersEvents);
	W.model.actionManager.events.register("noActions", null, requestHNs);
	W.accelerators.events.register("reloadData", null, requestHNs);
	W.editingMediator.on("change:editingHouseNumbers", requestHNs);
	W.editingMediator.on("change:editingHouseNumbers", setMarkersEvents);
	W.editingMediator.on("change:editingHouseNumbers", observeHNLayer);
	requestHNs();
}

function addLayerToggler(groupCheckbox, layer, checkboxId, text) {
	var layerToggler = {};
	layerToggler.htmlItem = "layer-switcher-item_hnnavpoints_" + checkboxId;
	layerToggler.layer = layer;
	var displayGroup = groupCheckbox.parentNode.parentNode.parentNode.parentNode.getElementsByTagName("UL")[0];
	var toggler = document.createElement("li");
	var togglerContainer = document.createElement("div");
	var checkbox = document.createElement("input");
	var label = document.createElement("label");
	var labelText = document.createElement("span");
	togglerContainer.className = "wz-checkbox";
	checkbox.type = "checkbox";
	checkbox.id = layerToggler.htmlItem;
	checkbox.className = "toggle";
	checkbox.disabled = !groupCheckbox.checked;
	togglerContainer.appendChild(checkbox);
	label.htmlFor = checkbox.id;
	labelText.className = "label-text";
	labelText.appendChild(document.createTextNode(text));
	label.appendChild(labelText);
	togglerContainer.appendChild(label);
	toggler.appendChild(togglerContainer);
	displayGroup.appendChild(toggler);
	checkbox.addEventListener("click", layerTogglerEventHandler(layer));
	groupCheckbox.addEventListener("click", layerTogglerGroupEventHandler(checkbox, layer));
	registerKeyShortcut(text, layerKeyShortcutEventHandler(groupCheckbox, checkbox), text.replace(/\s+/g, ''));
	return layerToggler;
}

function registerKeyShortcut(actionName, callback, keyName) {
	I18n.translations[I18n.locale].keyboard_shortcuts.groups.default.members[keyName] = actionName;
	W.accelerators.addAction(keyName, {group: "default"});
	W.accelerators.events.register(keyName, null, callback);
	W.accelerators._registerShortcuts({[""]: keyName});
}

function layerKeyShortcutEventHandler(groupCheckbox, checkbox) {
	return function() {
		if (!groupCheckbox.disabled) {
			checkbox.click();
		}
	};
}

function layerTogglerEventHandler(layer) {
	return function() {
		layer.setVisibility(this.checked & W.map.zoom >= maxZoom);
		requestHNs();
	};
}

function layerTogglerGroupEventHandler(checkbox, layer) {
	return function() {
		layer.setVisibility(this.checked & checkbox.checked & W.map.zoom >= maxZoom);
		checkbox.disabled = !this.checked;
		requestHNs();
	};
}

function requestHNs() {
	HNNavPointsLayer.setVisibility(document.getElementById(layerTogglers.hnLines.htmlItem).checked & !document.getElementById(layerTogglers.hnLines.htmlItem).disabled & W.map.zoom >= maxZoom);
	HNNavPointsNumbersLayer.setVisibility(document.getElementById(layerTogglers.hnNumbers.htmlItem).checked & !document.getElementById(layerTogglers.hnNumbers.htmlItem).disabled & W.map.zoom >= maxZoom);
	if (!HNNavPointsLayer.getVisibility() && !HNNavPointsNumbersLayer.getVisibility()) {
		return;
	}
	var eg = W.map.getExtent().toGeometry();
	var objSeg = W.model.segments.objects;
	var actSegmentsId = Object.keys(objSeg).filter(function(key) {
		if (objSeg[key].attributes.hasHNs && eg.intersects(objSeg[key].geometry)) {return key;}
	}).map(function (key) {
		return key;
	});
	var releasedSegmentsId = oldSegmentsId.filter(function(key) {return actSegmentsId.indexOf(key) < 0;});
	for (var i = 0; i < releasedSegmentsId.length; i++) {
		HNNavPointsLayer.removeFeatures(HNNavPointsLayer.getFeaturesByAttribute("segmentId", parseInt(releasedSegmentsId[i])));
		HNNavPointsNumbersLayer.removeFeatures(HNNavPointsNumbersLayer.getFeaturesByAttribute("segmentId", parseInt(releasedSegmentsId[i])));
	}
	var objHNs = W.model.segmentHouseNumbers.objects;
	for (var j in objHNs) {
		drawHNLine("MODEL", objHNs[j]);
	}
	var loadedSegmentsId = actSegmentsId.filter(function(key) {
		if (Object.keys(objHNs).indexOf(key) >= 0) {
			return false;
		} else {
			return (oldSegmentsId.indexOf(key) < 0 || lastDownloadTime < objSeg[key].attributes.updatedOn) ? true : false;
		}
	});
	oldSegmentsId = actSegmentsId;
	if (loadedSegmentsId.length > 0) {
		lastDownloadTime = Date.now();
		$.ajax({
			dataType: "json",
			url: getDownloadURL(),
			data: {ids: loadedSegmentsId.join(",")},
			success: function(json) {
				if (json.error !== undefined) {
				} else {
					var ids = [];
					if ("undefined" !== typeof(json.segmentHouseNumbers.objects)) {
						for (var k = 0; k < json.segmentHouseNumbers.objects.length; k++) {
							drawHNLine("JSON", json.segmentHouseNumbers.objects[k]);
						}
					}
				}
			}
		});
	}
}

function getDownloadURL(){
	var downloadURL = "https://www.waze.com";
	if (~document.URL.indexOf("https://beta.waze.com")) {
		downloadURL = "https://beta.waze.com";
	}
	downloadURL += W.Config.paths.houseNumbers;
	return downloadURL;
}

function drawHNLine(type, houseNumber) {
	var seg = W.model.segments.objects[houseNumber.segID];
	if (seg) {
		var streetId = seg.attributes.primaryStreetID;
		HNNavPointsLayer.removeFeatures(HNNavPointsLayer.getFeaturesByAttribute("featureId", streetId + "|" + houseNumber.number + "|" + houseNumber.id));
		HNNavPointsNumbersLayer.removeFeatures(HNNavPointsNumbersLayer.getFeaturesByAttribute("featureId", streetId + "|" + houseNumber.number + "|" + houseNumber.id));
		var p1, p2;
		var featureId = streetId + "|" + houseNumber.number + "|" + houseNumber.id;
		if (type == "JSON") {
			p1 = new OL.Geometry.Point(houseNumber.fractionPoint.coordinates[0], houseNumber.fractionPoint.coordinates[1]).transform(epsg4326, epsg900913);
			p2 = new OL.Geometry.Point(houseNumber.geometry.coordinates[0], houseNumber.geometry.coordinates[1]).transform(epsg4326, epsg900913);
		} else {
			p1 = new OL.Geometry.Point(houseNumber.fractionPoint.x, houseNumber.fractionPoint.y);
			p2 = new OL.Geometry.Point(houseNumber.geometry.x, houseNumber.geometry.y);
		}
		var lineString = new OL.Geometry.LineString([p1, p2]);
		var lineFeature = new OL.Feature.Vector(lineString, {streetId : streetId, segmentId : houseNumber.segID, featureId : featureId}, {strokeWidth: 4, strokeColor: "black", strokeOpacity: 0.5, strokeDashstyle: "dash", strokeDashArray: "8, 8"});
		var strokeColor;
		if (houseNumber.forced) {
			strokeColor = (!houseNumber.hasOwnProperty("updatedBy")) ? "red" : "orange";
		}
		else {
			strokeColor = (!houseNumber.hasOwnProperty("updatedBy")) ? "yellow" : "white";
		}
		HNNavPointsLayer.addFeatures(lineFeature);
		lineString = new OL.Geometry.LineString([p1, p2]);
		lineFeature = new OL.Feature.Vector(lineString, {streetId : streetId, segmentId : houseNumber.segID, featureId : featureId}, {strokeWidth: 2, strokeColor: strokeColor, strokeOpacity: 1, strokeDashstyle: "dash", strokeDashArray: "8, 8"});
		HNNavPointsLayer.addFeatures(lineFeature);
		HNNavPointsNumbersLayer.addFeatures(new OL.Feature.Vector(new OL.Geometry.Polygon.createRegularPolygon(p2, 1, 20), {streetId : streetId, segmentId : houseNumber.segID, featureId : featureId, hn_number: houseNumber.number, strokeWidth: 3, Color: strokeColor}));
	}
}

function setMarkersEvents() {
	if (W.editingMediator.attributes.editingHouseNumbers) {
		if (W.map.getLayersByName("houseNumberMarkers")[0].markers.length == 0) {
			setTimeout(setMarkersEvents, 50);
			return;
		}
		for (var marker of W.map.getLayersByName("houseNumberMarkers")[0].markers) {
			marker.events.register("click:input", null, markerRemoveLine(marker, false));
			marker.events.register("delete", null, markerRemoveLine(marker, true));
		}
	}
}

function markerRemoveLine(marker, permanent) {
	return function(){
		var HNtoRemove = W.model.segments.objects[marker.model.attributes.segID].attributes.primaryStreetID + "|" + marker.model.attributes.number + "|" + marker.model.attributes.id;
		var linesToRemove = HNNavPointsLayer.getFeaturesByAttribute("featureId", HNtoRemove);
		if (linesToRemove.length > 0) {
			HNNavPointsLayer.removeFeatures(linesToRemove);
			HNNavPointsNumbersLayer.removeFeatures(linesToRemove);
			if (!permanent) {
				observeRemovedLineTimer(marker);
			}
		}
		if (W.map.getLayersByName("houseNumberMarkers")[0].markers[0].events.listeners.delete.length < 2) {
			setMarkersEvents();
		}
	}
}

function observeRemovedLineTimer(marker) {
	setTimeout(function(){
		if (marker.dragging.active) {
			observeRemovedLineTimer(marker);
		} else {
			if (marker.model.attributes.number !== "" & W.map.getLayersByName("houseNumberMarkers")[0].markers.includes(marker)) {
				drawHNLine("MODEL", W.model.segmentHouseNumbers.objects[marker.model.attributes.id].attributes);
			}
		}
	}, 50);
}

function observeHNLayer() {
	if (W.editingMediator.attributes.editingHouseNumbers) {
		var observer = new MutationObserver(function(mutationsList, observer) {
			for(var mutation of mutationsList) {
				var input = $('div.olLayerDiv.house-numbers-layer div.house-number div.content.active:not(".new") input.number');
				if (input.val() === "") {
					input[0].addEventListener("change", setMarkersEvents);
				}
			}
		});
		observer.observe($('div.olLayerDiv.house-numbers-layer')[0], { childList:false, subtree:true, attributes: true });
	}
}
