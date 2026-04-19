# WME HN NavPoints

A Tampermonkey script for the Waze Map Editor that visualizes navigation points (nav points) for all house numbers on map segments. This script enhances the WME interface by displaying house number locations with interactive navigation points and optional numeric labels.

## Overview

**WME HN NavPoints** provides editors with a visual representation of where house numbers are positioned on segments in the Waze Map Editor. It displays:

- **Navigation point lines** - Visual indicators showing the exact location of each house number's navigation point
- **House number labels** - Optional text labels displaying the actual house number at each point

This script is particularly useful for:
- Verifying house number placement accuracy
- Identifying missing or misplaced navigation points
- Quickly editing multiple house numbers on a segment
- Validating house number geometry before saving

## Features

- 🗺️ **Dynamic rendering** - House numbers render/update as you zoom, pan, and edit
- 🎨 **Color-coded visualization** - Different colors for different house number types
- 🔍 **Smart layer management** - Separate layers for lines and numbers with independent toggle controls
- ⌨️ **Customizable shortcuts** - Assign keyboard shortcuts to toggle layers on/off
- 📊 **Settings persistence** - User preferences saved to browser localStorage
- 🔄 **Real-time sync** - Updates automatically as house numbers are added, edited, or deleted
- 🚀 **Performance optimized** - Uses efficient layer management and feature tracking
- ♿ **Accessibility** - Supports both standard WME and beta releases

## Installation

### Method : Greasy Fork (Recommended)

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Visit the [WME HN NavPoints script page on Greasy Fork](https://greasyfork.org/scripts/390565-wme-hn-navpoints)
3. Click **Install this script**
4. Confirm the installation in the Tampermonkey popup

## Usage

### Activation

The script automatically activates when you open the Waze Map Editor at:
- `https://www.waze.com/editor/` (Production)
- `https://beta.waze.com/editor/` (Beta)

You'll see **HN NavPoints** controls in the WME layers panel on the right side of the screen.

### Controlling Display

#### Toggle Layers

Use the checkboxes in the **Layers** panel:
- **HN NavPoints** - Toggle the house number navigation point lines on/off
- **HN NavPoints Numbers** - Toggle the house number labels on/off

#### Keyboard Shortcuts (Optional)

Once enabled, you can assign custom keyboard shortcuts in the settings panel:
- **Toggle HN NavPoints** - Show/hide the house number navigation point lines
- **Toggle HN NavPoints Numbers** - Show/hide the house number labels

### Zoom Requirements

House numbers are automatically hidden below zoom level 17 to reduce visual clutter at lower zoom levels. They will reappear when you zoom in to level 17 or higher.

### Interactive Features

**Hover over any navigation point** to see a tooltip containing:
- House number value
- Segment information
- Edit link (available when applicable)

**Click on a navigation point** to enter house number editing mode for that segment.

## Settings

Right-click the script icon (in Tampermonkey menu) and select "Options" to access settings:

| Setting | Default | Description |
|---------|---------|-------------|
| **Disable Below Zoom** | 17 | Minimum zoom level to display house numbers (11-29) |
| **Enable Tooltip** | ✓ Enabled | Show tooltips when hovering over navigation points |
| **HN Lines** | ✓ Enabled | Display house number navigation point lines |
| **HN Numbers** | ✓ Enabled | Display house number value labels |
| **Keep HN Layer On Top** | ✓ Enabled | Always render HN NavPoints above other map elements |

## Dependencies

The script requires:

- **WazeWrap** (auto-loaded) - WME integration library
- **Turf.js** v7.2.0 (auto-loaded) - Geospatial analysis library
- **WME SDK** - Waze Map Editor SDK (auto-provided)

All dependencies are automatically loaded via CDN, no manual installation required.

## Architecture

### Core Components

**Layer Management**
- Two separate OL (OpenLayers) layers for lines and numbers
- `__HNNavPointsLayer` - Contains house number navigation point lines
- `__HNNavPointsNumbersLayer` - Contains house number label text

**Feature Tracking**
- `_allLineFeatures` - Map of line features by ID
- `_allNumberFeatures` - Map of number features by ID  
- `_segmentHnIds` - Mapping of segment IDs to house numbers
- `_numberFeatureMeta` - Metadata for efficient feature lookups

**Event System**
- `segmentsEvent` - Detects segment edits/deletes
- `objectsChangedHNs` - Tracks house number changes
- `objectsStateDeletedHNs` - Handles house number deletions
- `zoomEndEvent` - Manages rendering based on zoom level

### Processing Pipeline

1. **Detection** - Monitor WME events for segment/HN changes
2. **Queuing** - Add affected segments to processing queue
3. **Processing** - Extract house numbers from segments
4. **Rendering** - Draw nav points and labels on layers
5. **Cleanup** - Remove obsolete features

## Configuration Files

The script stores settings in browser localStorage under the key:
```
WMEHNNavPoints
```

This can be manually modified via browser developer tools console:
```javascript
localStorage.setItem('WMEHNNavPoints', JSON.stringify({
    disableBelowZoom: 17,
    enableTooltip: true,
    hnLines: true,
    hnNumbers: true,
    keepHNLayerOnTop: true,
    shortcuts: {}
}));
```

## Debugging

The script includes debug output when running development versions (marked with Ω or β).

Enable debug logging in the browser console:
```javascript
// Check current version
console.log('Debug mode active:', /[βΩ]/.test('HN NavPoints β'));
```

Monitor processing queue status:
```javascript
// View pending segments
_segmentsToProcess
_processedSegments
_segmentsToRemove
```

## Requirements

- Modern browser with Tampermonkey support (Chrome, Firefox, Edge, etc.)
- Access to Waze Map Editor (requires Waze account)
- Minimum zoom level 11 (house numbers display at zoom 17+)

## Browser Support

- ✅ Chrome/Chromium (latest)
- ✅ Firefox (latest)
- ✅ Edge (latest)
- ✅ Safari with Tampermonkey

## Contributing

Found a bug or have a feature request? [Report it on GitHub](https://github.com/WazeDev/WME-HN-NavPoints/issues)

## Support & Discussion

- 📋 [Waze Forum Discussion](https://www.waze.com/forum/viewtopic.php?f=819&t=269397)
- 🐙 [GitHub Repository](https://github.com/WazeDev/WME-HN-NavPoints)
- ⭐ [Greasy Fork Page](https://greasyfork.org/scripts/390565-wme-hn-navpoints)

## Version History

See [releases](https://github.com/WazeDev/WME-HN-NavPoints/releases) for detailed changelog and version history.

## License

Licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) file for details.

## Credits

**Original Concept & Development**: MajkiiTelini  
**Current Maintenance**: [WazeDev Team](https://github.com/WazeDev)

Special thanks to MajkiiTelini for creating the original script and laying the foundation for this tool.

## Support the Project

If you find this script useful, consider:
- ⭐ Starring the repository on GitHub
- 📣 Sharing with other Waze editors
- 🤝 Contributing improvements and bug fixes
- 💬 Providing feedback on the [forum](https://www.waze.com/forum/viewtopic.php?f=819&t=269397)
- [Donate to Thank The Authors](https://github.com/WazeDev/Thank-The-Authors)