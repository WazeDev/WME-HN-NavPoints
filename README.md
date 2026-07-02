# WME HN NavPoints

A Waze Map Editor (WME) userscript that visualizes house number navigation points with customizable markers and connection lines. Displays all house numbers in the viewport with color-coded status indicators.

**License:** GPLv3  
**Script ID:** [390565](https://greasyfork.org/scripts/390565-wme-hn-navpoints)

## Features

- **Visual Navigation Points** — Shows all house number markers and connection lines on the map
- **Color-Coded Status** — Indicators distinguish between:
  - **Red** — Forced navigation point (untouched)
  - **Orange** — Forced navigation point (modified)
  - **Yellow** — Updated navigation point (untouched)
  - **White** — Updated navigation point (modified)

- **Smart Viewport Caching** — Renders only house numbers in the current map view; caches data for fast panning
- **Keyboard Shortcuts** — Toggle layers without opening the sidebar
- **Customizable Marker Styling** — Control size, font, and opacity from the sidebar
- **Layer Visibility Controls** — Toggle lines and markers independently

## Installation

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Safari)
   - [Greasemonkey](https://www.greaseyfork.org/) (Firefox)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox, Edge)

2. Install the script:
   - [Install from Greasyfork](https://greasyfork.org/scripts/390565-wme-hn-navpoints/code/WME%20HN%20NavPoints.user.js)

3. Open WME in your browser; the script will initialize automatically

## Usage

### Sidebar Panel

The script adds a **"HN NavPoints"** tab in the WME sidebar. Click the location pin icon to open the settings panel.

#### Settings Card

- **Min Zoom Level** — Only display house numbers at this zoom level or higher (default: 17)
  - Reduces clutter at lower zoom levels; saves performance
- **Z-index Position** — Control layer stacking:
  - **Above GIS Layers** — House number markers appear on top
  - **Below GIS Layers** — House numbers render behind other layers
  - **Disabled** — Turn off z-index manipulation

#### Marker Styling Card

Fine-tune the appearance of house number markers in real-time:

- **Size** — Marker point radius in pixels (8–24, default: 14)
  - Adjust for visibility and map clarity
- **Font** — Text size for house numbers (8–16px, default: 11px)
  - Larger fonts improve readability at high zoom
- **Opacity** — Marker fill opacity as percentage (10–100%, default: 100%)
  - Reduce opacity to see underlying map features

#### Color Legend

Reference card showing the meaning of each marker color:
- Red = Forced (untouched)
- Orange = Forced (touched)
- Yellow = Updated (untouched)
- White = Updated (touched)

### Keyboard Shortcuts

Toggle layers without opening the sidebar:

| Shortcut    | Action                                       |
| ----------- | -------------------------------------------- |
| **Shift+N** | Toggle HN NavPoints Lines (connection lines) |
| **Shift+M** | Toggle HN NavPoints Numbers (markers)        |

Shortcuts are customizable via WME's keyboard settings (**Settings → Keyboard**).

### Sidebar Layer Checkboxes

In WME's **Layers** panel, two checkboxes control visibility:

- **HN NavPoints Lines** — Toggle connection lines from markers to segments
- **HN NavPoints Numbers** — Toggle house number markers

These sync with keyboard shortcuts and the Settings card toggles.

## Performance Notes

- **Smart Rendering** — Only fetches and renders house numbers in the current viewport
- **Data Caching** — Previously loaded segments are cached when panning, speeding up navigation
- **Zoom Optimization** — House numbers don't load below the minimum zoom threshold (saves CPU)
- **Batch Processing** — Segments are fetched in batches of 100 for efficiency

## Troubleshooting

### House numbers aren't showing

1. **Check zoom level** — Make sure you're zoomed in to at least level 17 (or your configured minimum)
2. **Verify layer checkboxes** — Enable both layer checkboxes in the **Layers** panel
3. **Check the sidebar** — Open the HN NavPoints sidebar tab to verify settings are enabled
4. **Browser console** — Press `F12` and check the console for errors

### Keyboard shortcuts not working

- **Conflicts detected** — If a shortcut key is already in use, the script will skip it (check console logs)
- **Customize shortcuts** — Go to **Settings → Keyboard** in WME to rebind Shift+N and Shift+M
