/* Smart Board — vector editor with control points, viewport zoom, edit/crop tools */

const liveCanvas = document.getElementById('liveCanvas');
const mainCanvas = document.getElementById('mainCanvas');
const liveCtx = liveCanvas.getContext('2d');
const mainCtx = mainCanvas.getContext('2d');

const smartModeCheckbox = document.getElementById('smartMode');
const brushSizeInput = document.getElementById('brushSize');
const brushSizeVal = document.getElementById('brushSizeVal');
const toleranceInput = document.getElementById('tolerance');
const toleranceVal = document.getElementById('toleranceVal');
const clearBtn = document.getElementById('clearBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const copySelectionBtn = document.getElementById('copySelectionBtn');
const duplicateBtn = document.getElementById('duplicateBtn');
const drawToolBtn = document.getElementById('drawToolBtn');
const textToolBtn = document.getElementById('textToolBtn');
const editToolBtn = document.getElementById('editToolBtn');
const cropToolBtn = document.getElementById('cropToolBtn');
const bgWhiteBtn = document.getElementById('bgWhiteBtn');
const bgBlackBtn = document.getElementById('bgBlackBtn');
const statusConsole = document.getElementById('statusConsole');
const colorPalette = document.getElementById('colorPalette');
const textInput = document.getElementById('textInput');
const textEditorPopup = document.getElementById('textEditorPopup');
const textSizeInput = document.getElementById('textSizeInput');
const insertTextBtn = document.getElementById('insertTextBtn');
const cancelTextBtn = document.getElementById('cancelTextBtn');
const textPreview = document.getElementById('textPreview');
const zoomSlider = document.getElementById('zoomSlider');
const zoomLevelLabel = document.getElementById('zoomLevelLabel');
const zoomInBtnMobile = document.getElementById('zoomInBtnMobile');
const zoomOutBtnMobile = document.getElementById('zoomOutBtnMobile');
const zoomLevelLabelMobile = document.getElementById('zoomLevelLabelMobile');
const desktopToolbarMount = document.getElementById('desktopToolbarMount');
const headerControls = document.getElementById('headerControls');
const activeToolBadge = document.getElementById('activeToolBadge');

const colors = [
    '#f87171', '#fb923c', '#facc15', '#4ade80',
    '#2dd4bf', '#38bdf8', '#6366f1', '#c084fc',
    '#f472b6', '#cbd5e1', '#ffffff', '#000000'
];

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.15;
const PASTE_OFFSET = 16;
const HANDLE_VISUAL_RADIUS = 5;
const HANDLE_HIT_RADIUS = 10;
const HANDLE_HIT_RADIUS_TOUCH = 22;
const MOBILE_BREAKPOINT = 768;

let currentLineWidth = 4;
let rdpEpsilon = 2.0;
let currentColor = '#6366f1';
let currentTool = 'draw';
let currentBackground = 'white';
let dpr = window.devicePixelRatio || 1;
let isPointerActive = false;
let pointerPoints = [];
let cropStart = null;
let cropRect = null;
let selectionBox = null;
let selectionBoxStart = null;
let shapes = [];
let undoStack = [];
let redoStack = [];
let mathJaxReadyPromise = null;
let pendingTextPlacement = null;
let editingTextShapeId = null;
let selectedShapeIds = new Set();
let internalClipboard = null;
let dragState = null;
let suppressNextStroke = false;
let touchMode = null;
let pinchState = null;

let viewport = { scale: 1, offsetX: 0, offsetY: 0 };

const textMeasureCanvas = document.createElement('canvas');
const textMeasureCtx = textMeasureCanvas.getContext('2d');
const textRenderCache = new Map();

const TOOL_ICONS = {
    draw: 'fa-pen',
    text: 'fa-font',
    edit: 'fa-arrow-pointer',
    crop: 'fa-crop-simple'
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
}

function createShapeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `shape-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cloneShape(shape) {
    return migrateLegacyShape(cloneData(shape));
}

function cloneShapeWithNewId(shape, offsetX = 0, offsetY = 0) {
    const clone = cloneShape(shape);
    clone.id = createShapeId();
    translateShape(clone, offsetX, offsetY);
    return clone;
}

function isMobileViewport() {
    return window.innerWidth < MOBILE_BREAKPOINT;
}

function getHandleHitRadius() {
    return isMobileViewport() || window.matchMedia('(pointer: coarse)').matches
        ? HANDLE_HIT_RADIUS_TOUCH
        : HANDLE_HIT_RADIUS;
}

function pointByRole(shape, role) {
    return shape.controlPoints.find(p => p.role === role);
}

function anchors(shape) {
    return shape.controlPoints.filter(p => p.role === 'anchor');
}

// ─── Viewport ────────────────────────────────────────────────────────────────

function screenToWorld(screen) {
    return {
        x: (screen.x - viewport.offsetX) / viewport.scale,
        y: (screen.y - viewport.offsetY) / viewport.scale
    };
}

function worldToScreen(world) {
    return {
        x: world.x * viewport.scale + viewport.offsetX,
        y: world.y * viewport.scale + viewport.offsetY
    };
}

function resetCanvasTransform(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
}

function applyViewportTransform(ctx) {
    ctx.setTransform(
        viewport.scale * dpr, 0, 0, viewport.scale * dpr,
        viewport.offsetX * dpr, viewport.offsetY * dpr
    );
}

function clampZoom(scale) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

function updateZoomLabel() {
    const label = `${Math.round(viewport.scale * 100)}%`;
    if (zoomSlider) zoomSlider.value = String(Math.round(viewport.scale * 100));
    if (zoomLevelLabel) zoomLevelLabel.textContent = label;
    if (zoomLevelLabelMobile) zoomLevelLabelMobile.textContent = label;
}

function setZoomScale(nextScale, anchorScreenX = liveCanvas.clientWidth / 2, anchorScreenY = liveCanvas.clientHeight / 2) {
    const worldBefore = screenToWorld({ x: anchorScreenX, y: anchorScreenY });
    const clampedScale = clampZoom(nextScale);
    viewport.scale = clampedScale;
    viewport.offsetX = anchorScreenX - worldBefore.x * clampedScale;
    viewport.offsetY = anchorScreenY - worldBefore.y * clampedScale;
    updateZoomLabel();
    renderScene();
}

function zoomAt(factor, anchorScreenX, anchorScreenY) {
    setZoomScale(viewport.scale * factor, anchorScreenX, anchorScreenY);
}

function zoomIn() {
    const cx = liveCanvas.clientWidth / 2;
    const cy = liveCanvas.clientHeight / 2;
    zoomAt(ZOOM_STEP, cx, cy);
}

function zoomOut() {
    const cx = liveCanvas.clientWidth / 2;
    const cy = liveCanvas.clientHeight / 2;
    zoomAt(1 / ZOOM_STEP, cx, cy);
}

function zoomReset() {
    viewport = { scale: 1, offsetX: 0, offsetY: 0 };
    updateZoomLabel();
    renderScene();
}

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}

function getTouchMidpointScreen(touches) {
    const rect = liveCanvas.getBoundingClientRect();
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left,
        y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top
    };
}

// ─── Shape model & migration ─────────────────────────────────────────────────

function buildLineControlPoints(start, end) {
    return [
        { x: start.x, y: start.y, role: 'start' },
        { x: end.x, y: end.y, role: 'end' }
    ];
}

function buildRectControlPoints(x, y, width, height) {
    return [
        { x, y, role: 'cornerTL' },
        { x: x + width, y, role: 'cornerTR' },
        { x: x + width, y: y + height, role: 'cornerBR' },
        { x, y: y + height, role: 'cornerBL' }
    ];
}

function buildCircleControlPoints(centerX, centerY, radius) {
    return [
        { x: centerX, y: centerY, role: 'center' },
        { x: centerX + radius, y: centerY, role: 'radius' }
    ];
}

function buildEllipseControlPoints(centerX, centerY, radiusX, radiusY, rotation = 0) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return [
        { x: centerX, y: centerY, role: 'center' },
        { x: centerX + radiusX * cos, y: centerY + radiusX * sin, role: 'axisMajor' },
        { x: centerX - radiusY * sin, y: centerY + radiusY * cos, role: 'axisMinor' }
    ];
}

function buildCurveControlPoints(points) {
    return points.map(p => ({ x: p.x, y: p.y, role: 'anchor' }));
}

function buildTextControlPoints(x, y, maxWidth) {
    return [
        { x, y, role: 'topLeft' },
        { x: x + maxWidth, y, role: 'widthHandle' }
    ];
}

function getRectFromCorners(corners) {
    const xs = corners.map(p => p.x);
    const ys = corners.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function getEllipseParams(shape) {
    const center = pointByRole(shape, 'center');
    const major = pointByRole(shape, 'axisMajor');
    const minor = pointByRole(shape, 'axisMinor');
    if (!center || !major || !minor) return { centerX: 0, centerY: 0, radiusX: 1, radiusY: 1, rotation: 0 };
    const radiusX = Math.hypot(major.x - center.x, major.y - center.y);
    const radiusY = Math.hypot(minor.x - center.x, minor.y - center.y);
    const rotation = Math.atan2(major.y - center.y, major.x - center.x);
    return { centerX: center.x, centerY: center.y, radiusX, radiusY, rotation };
}

function getTextPosition(shape) {
    const topLeft = pointByRole(shape, 'topLeft');
    return topLeft ? { x: topLeft.x, y: topLeft.y } : { x: 0, y: 0 };
}

function syncTextMaxWidthFromHandles(shape) {
    const topLeft = pointByRole(shape, 'topLeft');
    const widthHandle = pointByRole(shape, 'widthHandle');
    if (topLeft && widthHandle) {
        shape.maxWidth = Math.max(40, widthHandle.x - topLeft.x);
    }
}

function migrateLegacyShape(oldShape) {
    if (!oldShape) return oldShape;
    if (oldShape.id && oldShape.controlPoints) {
        return oldShape;
    }

    const base = {
        id: createShapeId(),
        color: oldShape.color,
        lineWidth: oldShape.lineWidth,
        displayMode: oldShape.displayMode || 'normalized',
        rawPoints: oldShape.rawPoints || null,
        smoothedPoints: oldShape.smoothedPoints || null,
        normalizedType: oldShape.normalizedType || null,
        userEdited: oldShape.userEdited || false
    };

    if (oldShape.type === 'line') {
        return {
            ...base,
            type: 'line',
            controlPoints: buildLineControlPoints(oldShape.start, oldShape.end),
            normalizedType: 'line',
            rawPoints: oldShape.rawPoints,
            smoothedPoints: oldShape.smoothedPoints
        };
    }
    if (oldShape.type === 'rect') {
        return {
            ...base,
            type: 'rect',
            controlPoints: buildRectControlPoints(oldShape.x, oldShape.y, oldShape.width, oldShape.height),
            normalizedType: 'rect',
            rawPoints: oldShape.rawPoints,
            smoothedPoints: oldShape.smoothedPoints
        };
    }
    if (oldShape.type === 'circle') {
        return {
            ...base,
            type: 'circle',
            controlPoints: buildCircleControlPoints(oldShape.centerX, oldShape.centerY, oldShape.radius),
            normalizedType: 'circle',
            rawPoints: oldShape.rawPoints,
            smoothedPoints: oldShape.smoothedPoints
        };
    }
    if (oldShape.type === 'ellipse') {
        return {
            ...base,
            type: 'ellipse',
            controlPoints: buildEllipseControlPoints(
                oldShape.centerX, oldShape.centerY,
                oldShape.radiusX, oldShape.radiusY, oldShape.rotation || 0
            ),
            normalizedType: 'ellipse',
            rawPoints: oldShape.rawPoints,
            smoothedPoints: oldShape.smoothedPoints
        };
    }
    if (oldShape.type === 'curve') {
        const pts = oldShape.points || [];
        return {
            ...base,
            type: 'curve',
            controlPoints: buildCurveControlPoints(pts),
            smoothedPoints: pts,
            normalizedType: null
        };
    }
    if (oldShape.type === 'text') {
        const x = oldShape.x;
        const y = oldShape.y;
        const naturalWidth = measureTextWidth(oldShape.text, oldShape.fontSize);
        const maxWidth = oldShape.maxWidth || naturalWidth;
        return {
            ...base,
            type: 'text',
            text: oldShape.text,
            fontSize: oldShape.fontSize,
            maxWidth,
            controlPoints: buildTextControlPoints(x, y, maxWidth)
        };
    }
    return { ...base, type: oldShape.type || 'curve', controlPoints: [] };
}

function translateShape(shape, dx, dy) {
    shape.controlPoints.forEach(p => {
        p.x += dx;
        p.y += dy;
    });
    if (shape.rawPoints) shape.rawPoints.forEach(p => { p.x += dx; p.y += dy; });
    if (shape.smoothedPoints) shape.smoothedPoints.forEach(p => { p.x += dx; p.y += dy; });
}

function getShapeById(id) {
    return shapes.find(s => s.id === id);
}

function shapeHasDualState(shape) {
    return shape.smoothedPoints && shape.smoothedPoints.length >= 2
        && shape.normalizedType && shape.normalizedType !== 'curve';
}

function toggleDisplayModeForSelection() {
    if (currentTool !== 'edit' || selectedShapeIds.size === 0) return false;
    let toggled = 0;
    selectedShapeIds.forEach(id => {
        const shape = getShapeById(id);
        if (!shape || !shapeHasDualState(shape)) return;
        shape.displayMode = shape.displayMode === 'prototype' ? 'normalized' : 'prototype';
        toggled++;
    });
    if (toggled > 0) {
        renderScene();
        logStatus(`Toggled ${toggled} shape(s) to ${[...selectedShapeIds].map(id => getShapeById(id)?.displayMode).includes('prototype') ? 'prototype (smoothed)' : 'normalized'} view. Press Z again to switch back.`);
        return true;
    }
    return false;
}

// ─── Undo / snapshot ─────────────────────────────────────────────────────────

function snapshotState() {
    return {
        shapes: cloneData(shapes),
        background: currentBackground
    };
}

function pushUndoState() {
    undoStack.push(snapshotState());
    redoStack = [];
    updateActionButtons();
}

function restoreSnapshot(snapshot) {
    shapes = snapshot.shapes.map(s => migrateLegacyShape(s));
    currentBackground = snapshot.background;
    applyBackgroundTheme();
    clearObjectSelection();
    clearCropSelection();
    renderScene();
    updateActionButtons();
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function updatePaletteButtons() {
    const borderColor = currentBackground === 'white' ? '#0f172a' : '#ffffff';
    Array.from(colorPalette.children).forEach(button => {
        const isSelected = button.dataset.color === currentColor;
        button.style.borderColor = borderColor;
        button.style.borderWidth = isSelected ? '2.5px' : '1px';
    });
}

function configureContext(ctx) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 0.5;
}

function logStatus(message) {
    statusConsole.textContent = message;
}

function updateActionButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
    copySelectionBtn.disabled = !cropRect;
    duplicateBtn.disabled = selectedShapeIds.size === 0;
}

function applyBackgroundTheme() {
    document.body.classList.toggle('theme-light', currentBackground === 'white');
    document.body.classList.toggle('theme-dark', currentBackground === 'black');
    bgWhiteBtn.classList.toggle('is-active', currentBackground === 'white');
    bgBlackBtn.classList.toggle('is-active', currentBackground === 'black');
    updatePaletteButtons();
}

function updateActiveToolBadge() {
    const icon = TOOL_ICONS[currentTool] || 'fa-pen';
    activeToolBadge.innerHTML = `<i class="fa-solid ${icon}"></i>`;
}

function openToolbarDrawer() {
}

function closeToolbarDrawer() {
}

function toggleToolbarDrawer() {
}

function layoutToolbar() {
    if (!headerControls || !desktopToolbarMount) return;
    if (!desktopToolbarMount.contains(headerControls)) {
        desktopToolbarMount.appendChild(headerControls);
    }
}

function resizeCanvases() {
    layoutToolbar();
    dpr = window.devicePixelRatio || 1;
    const width = liveCanvas.parentElement.clientWidth;
    const height = liveCanvas.parentElement.clientHeight;

    liveCanvas.width = width * dpr;
    liveCanvas.height = height * dpr;
    mainCanvas.width = width * dpr;
    mainCanvas.height = height * dpr;

    liveCanvas.style.width = width + 'px';
    liveCanvas.style.height = height + 'px';
    mainCanvas.style.width = width + 'px';
    mainCanvas.style.height = height + 'px';

    configureContext(liveCtx);
    configureContext(mainCtx);
    renderScene();
}

function initColorPalette() {
    colors.forEach(color => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'palette-color-btn w-10 h-10 rounded-lg transition transform active:scale-95 shadow-sm';
        button.style.backgroundColor = color;
        button.dataset.color = color;
        if (color === currentColor) button.classList.add('is-selected');

        button.addEventListener('click', () => {
            Array.from(colorPalette.children).forEach(btn => btn.classList.remove('is-selected'));
            button.classList.add('is-selected');
            currentColor = color;
            updatePaletteButtons();
            renderScene();
        });
        colorPalette.appendChild(button);
    });
    updatePaletteButtons();
}

function setTool(tool) {
    currentTool = tool;
    drawToolBtn.classList.toggle('is-active', tool === 'draw');
    textToolBtn.classList.toggle('is-active', tool === 'text');
    editToolBtn.classList.toggle('is-active', tool === 'edit');
    cropToolBtn.classList.toggle('is-active', tool === 'crop');
    liveCanvas.classList.toggle('is-drawing', tool === 'draw');
    liveCanvas.classList.toggle('is-text', tool === 'text');
    liveCanvas.classList.toggle('is-editing', tool === 'edit');
    liveCanvas.classList.toggle('is-cropping', tool === 'crop');
    updateActiveToolBadge();

    if (tool === 'draw') {
        hideTextEditorPopup();
        clearObjectSelection();
        clearCropSelection();
        logStatus('Draw mode is active.');
    } else if (tool === 'text') {
        clearObjectSelection();
        clearCropSelection();
        hideTextEditorPopup();
        logStatus('Text mode is active. Click the canvas to open the text editor.');
    } else if (tool === 'edit') {
        hideTextEditorPopup();
        clearCropSelection();
        if (selectedShapeIds.size === 0 && shapes.length > 0) {
            selectedShapeIds.add(shapes[shapes.length - 1].id);
        }
        updateActionButtons();
        logStatus('Edit mode is active. Click shapes to select. Shift+click for multi-select. Z toggles prototype view.');
    } else {
        hideTextEditorPopup();
        clearObjectSelection();
        logStatus('Crop mode is active. Drag to select a region, then copy as PNG.');
    }

    renderScene();
}

// ─── Text / MathJax ──────────────────────────────────────────────────────────

function getTextShapeCacheKey(shape) {
    const pos = getTextPosition(shape);
    return JSON.stringify({
        text: shape.text,
        x: pos.x,
        y: pos.y,
        color: shape.color,
        fontSize: shape.fontSize,
        maxWidth: shape.maxWidth
    });
}

function isBlockFormula(text) {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (/^\\begin\{[\s\S]+\\end\{[\s\S]+\}$/.test(trimmed)) return true;
    if (/^\$\$[\s\S]+\$\$$/.test(trimmed)) return true;
    if (/^\\\[[\s\S]+\\\]$/.test(trimmed)) return true;
    return false;
}

function unwrapBlockFormula(text) {
    const trimmed = text.trim();
    if (/^\$\$[\s\S]+\$\$$/.test(trimmed)) return trimmed.slice(2, -2).trim();
    if (/^\\\[[\s\S]+\\\]$/.test(trimmed)) return trimmed.slice(2, -2).trim();
    return trimmed;
}

function parseTextBlocks(text) {
    const blocks = [];
    const regex = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\])/g;
    let lastIndex = 0;
    let match;

    function pushTextLines(chunk) {
        const lines = chunk.split(/\r?\n/);
        lines.forEach((line, index) => {
            if (index > 0 || line.length > 0) {
                blocks.push({ type: 'text-line', content: line });
            }
        });
    }

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            pushTextLines(text.slice(lastIndex, match.index));
        }
        blocks.push({ type: 'block-formula', content: unwrapBlockFormula(match[1]) });
        lastIndex = match.index + match[1].length;
    }

    if (lastIndex < text.length) {
        pushTextLines(text.slice(lastIndex));
    }

    if (!blocks.length) {
        blocks.push({ type: 'text-line', content: '' });
    }

    return blocks;
}

function getFormulaMarkup(line) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\$(.+)\$$/);
    return match ? match[1].trim() : null;
}

function parseLineSegments(line) {
    const segments = [];
    const regex = /(\$[^$]+\$)/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(line)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', content: line.slice(lastIndex, match.index) });
        }
        segments.push({ type: 'formula', content: match[1].slice(1, -1).trim() });
        lastIndex = match.index + match[1].length;
    }
    if (lastIndex < line.length) segments.push({ type: 'text', content: line.slice(lastIndex) });
    if (!segments.length) segments.push({ type: 'text', content: '' });
    return segments;
}

function waitForMathJax() {
    if (!window.MathJax?.startup?.promise) return Promise.resolve(null);
    if (!mathJaxReadyPromise) mathJaxReadyPromise = window.MathJax.startup.promise;
    return mathJaxReadyPromise;
}

function measureTextWidth(text, fontSize) {
    textMeasureCtx.font = `${fontSize}px 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
    return textMeasureCtx.measureText(text || ' ').width;
}

function wrapTextContent(text, maxWidth, fontSize) {
    if (!text) return [''];
    const words = text.split(/(\s+)/);
    const lines = [];
    let current = '';
    words.forEach(word => {
        const test = current + word;
        if (measureTextWidth(test, fontSize) <= maxWidth || !current) {
            current = test;
        } else {
            if (current.trim()) lines.push(current);
            current = word.trimStart();
        }
    });
    if (current) lines.push(current);
    if (!lines.length) lines.push('');
    return lines;
}

function loadImageFromSvg(svgMarkup) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
    });
}

async function renderFormulaLine(formula, color, fontSize, display = false) {
    await waitForMathJax();
    if (!window.MathJax?.tex2svg) return null;

    const wrapper = window.MathJax.tex2svg(formula, { display });
    const svg = wrapper.querySelector('svg');
    if (!svg) return null;

    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.style.color = color;
    svg.setAttribute('fill', color);

    const measureHost = document.createElement('div');
    measureHost.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
    measureHost.style.fontSize = `${fontSize}px`;
    measureHost.style.color = color;
    measureHost.appendChild(svg.cloneNode(true));
    document.body.appendChild(measureHost);

    const renderedSvg = measureHost.querySelector('svg');
    const rect = renderedSvg.getBoundingClientRect();
    renderedSvg.setAttribute('width', `${Math.max(1, rect.width)}`);
    renderedSvg.setAttribute('height', `${Math.max(1, rect.height)}`);
    renderedSvg.setAttribute('viewBox', renderedSvg.getAttribute('viewBox') || `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);

    const markup = new XMLSerializer().serializeToString(renderedSvg);
    document.body.removeChild(measureHost);

    const image = await loadImageFromSvg(markup);
    return {
        type: 'formula',
        formula,
        image,
        width: Math.max(1, rect.width),
        height: Math.max(fontSize * (display ? 1.5 : 1.2), rect.height)
    };
}

async function buildWrappedLineSegments(line, shape, maxWidth) {
    const fullLineFormula = getFormulaMarkup(line);
    if (fullLineFormula) {
        const formulaLine = await renderFormulaLine(fullLineFormula, shape.color, shape.fontSize);
        if (formulaLine) return [{ segments: [formulaLine], width: formulaLine.width, height: formulaLine.height }];
    }

    const rawSegments = parseLineSegments(line);
    const wrappedLines = [];
    let currentSegments = [];
    let currentWidth = 0;
    let currentHeight = shape.fontSize * 1.35;

    async function flushLine() {
        if (currentSegments.length) {
            wrappedLines.push({
                segments: currentSegments,
                width: currentWidth,
                height: currentHeight
            });
        }
        currentSegments = [];
        currentWidth = 0;
        currentHeight = shape.fontSize * 1.35;
    }

    for (const segment of rawSegments) {
        if (segment.type === 'formula') {
            const formulaSegment = await renderFormulaLine(segment.content, shape.color, shape.fontSize);
            if (formulaSegment) {
                if (currentWidth > 0 && currentWidth + formulaSegment.width > maxWidth) await flushLine();
                currentSegments.push(formulaSegment);
                currentWidth += formulaSegment.width;
                currentHeight = Math.max(currentHeight, formulaSegment.height);
                if (formulaSegment.width > maxWidth) await flushLine();
                continue;
            }
        }

        const textLines = wrapTextContent(segment.content, maxWidth - currentWidth > 0 ? maxWidth - currentWidth : maxWidth, shape.fontSize);
        for (let i = 0; i < textLines.length; i++) {
            if (i > 0) await flushLine();
            const piece = textLines[i];
            const textSegment = {
                type: 'text',
                text: piece,
                width: measureTextWidth(piece, shape.fontSize),
                height: shape.fontSize * 1.35
            };
            if (currentWidth > 0 && currentWidth + textSegment.width > maxWidth) await flushLine();
            currentSegments.push(textSegment);
            currentWidth += textSegment.width;
        }
    }
    await flushLine();
    return wrappedLines;
}

async function prepareTextRenderData(shape) {
    const cacheKey = getTextShapeCacheKey(shape);
    if (textRenderCache.has(cacheKey)) return textRenderCache.get(cacheKey);

    const maxWidth = shape.maxWidth || measureTextWidth(shape.text, shape.fontSize);

    if (isBlockFormula(shape.text)) {
        const formulaBlock = await renderFormulaLine(unwrapBlockFormula(shape.text), shape.color, shape.fontSize, true);
        if (formulaBlock) {
            const renderData = {
                width: Math.min(formulaBlock.width, maxWidth),
                height: formulaBlock.height,
                lines: [{ type: 'rich-line', width: formulaBlock.width, height: formulaBlock.height, segments: [formulaBlock] }]
            };
            textRenderCache.set(cacheKey, renderData);
            return renderData;
        }
    }

    const renderLines = [];

    for (const block of parseTextBlocks(shape.text)) {
        if (block.type === 'block-formula') {
            const formulaBlock = await renderFormulaLine(block.content, shape.color, shape.fontSize, true);
            if (formulaBlock) {
                renderLines.push({
                    type: 'rich-line',
                    width: formulaBlock.width,
                    height: formulaBlock.height,
                    segments: [formulaBlock]
                });
            }
            continue;
        }

        const wrapped = await buildWrappedLineSegments(block.content, shape, maxWidth);
        wrapped.forEach(wl => {
            renderLines.push({ type: 'rich-line', width: wl.width, height: wl.height, segments: wl.segments });
        });
    }

    const renderData = {
        width: Math.min(maxWidth, renderLines.reduce((m, l) => Math.max(m, l.width), 0)),
        height: renderLines.reduce((t, l) => t + l.height, 0),
        lines: renderLines
    };
    textRenderCache.set(cacheKey, renderData);
    return renderData;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function clearLiveOverlay() {
    resetCanvasTransform(liveCtx);
    liveCtx.clearRect(0, 0, liveCanvas.width / dpr, liveCanvas.height / dpr);
}

function clearObjectSelection() {
    selectedShapeIds.clear();
    selectionBox = null;
    selectionBoxStart = null;
    dragState = null;
    updateActionButtons();
}

function clearCropSelection() {
    cropRect = null;
    cropStart = null;
    updateActionButtons();
}

function clearSelection() {
    clearObjectSelection();
    clearCropSelection();
    clearLiveOverlay();
}

function renderScene() {
    const width = mainCanvas.width / dpr;
    const height = mainCanvas.height / dpr;

    resetCanvasTransform(mainCtx);
    mainCtx.clearRect(0, 0, width, height);
    mainCtx.fillStyle = currentBackground === 'white' ? '#ffffff' : '#020617';
    mainCtx.fillRect(0, 0, width, height);

    mainCtx.save();
    applyViewportTransform(mainCtx);
    shapes.forEach(shape => drawShape(mainCtx, shape));
    mainCtx.restore();

    drawLiveOverlays();
}

function drawShape(ctx, shape) {
    if (shape.displayMode === 'prototype' && shape.smoothedPoints?.length >= 2) {
        ctx.save();
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.lineWidth;
        ctx.shadowColor = shape.color;
        drawSmoothedCurve(ctx, shape.smoothedPoints);
        ctx.restore();
        return;
    }

    ctx.save();
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.lineWidth;
    ctx.shadowColor = shape.color;

    if (shape.type === 'line') {
        const start = pointByRole(shape, 'start');
        const end = pointByRole(shape, 'end');
        if (start && end) {
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        }
    } else if (shape.type === 'rect') {
        const rect = getRectFromCorners(shape.controlPoints);
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
        ctx.stroke();
    } else if (shape.type === 'circle') {
        const center = pointByRole(shape, 'center');
        const radiusPt = pointByRole(shape, 'radius');
        if (center && radiusPt) {
            const r = Math.hypot(radiusPt.x - center.x, radiusPt.y - center.y);
            ctx.beginPath();
            ctx.arc(center.x, center.y, r, 0, 2 * Math.PI);
            ctx.stroke();
        }
    } else if (shape.type === 'ellipse') {
        const { centerX, centerY, radiusX, radiusY, rotation } = getEllipseParams(shape);
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, Math.max(1, radiusX), Math.max(1, radiusY), rotation, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (shape.type === 'text') {
        drawTextShape(ctx, shape);
    } else if (shape.type === 'curve') {
        const pts = anchors(shape).length ? anchors(shape) : shape.smoothedPoints || [];
        drawSmoothedCurve(ctx, pts);
    }

    ctx.restore();
}

function drawTextShape(ctx, shape) {
    const pos = getTextPosition(shape);
    const cacheKey = getTextShapeCacheKey(shape);
    const renderData = textRenderCache.get(cacheKey);

    if (!renderData) {
        void prepareTextRenderData(shape).then(() => renderScene());
        ctx.fillStyle = shape.color;
        ctx.font = `${shape.fontSize}px 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
        ctx.textBaseline = 'top';
        shape.text.split(/\r?\n/).forEach((line, index) => {
            ctx.fillText(line, pos.x, pos.y + index * shape.fontSize * 1.35);
        });
        return;
    }

    let cursorY = pos.y;
    ctx.fillStyle = shape.color;
    ctx.font = `${shape.fontSize}px 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
    ctx.textBaseline = 'top';

    renderData.lines.forEach(line => {
        let cursorX = pos.x;
        (line.segments || [line]).forEach(segment => {
            if (segment.type === 'formula') {
                ctx.drawImage(segment.image, cursorX, cursorY, segment.width, segment.height);
            } else {
                ctx.fillText(segment.text, cursorX, cursorY);
            }
            cursorX += segment.width;
        });
        cursorY += line.height;
    });
}

function drawSmoothedCurve(ctx, simplifiedPoints) {
    if (simplifiedPoints.length < 2) return;
    if (simplifiedPoints.length === 2) {
        ctx.beginPath();
        ctx.moveTo(simplifiedPoints[0].x, simplifiedPoints[0].y);
        ctx.lineTo(simplifiedPoints[1].x, simplifiedPoints[1].y);
        ctx.stroke();
        return;
    }
    ctx.beginPath();
    ctx.moveTo(simplifiedPoints[0].x, simplifiedPoints[0].y);
    let i = 1;
    for (i = 1; i < simplifiedPoints.length - 2; i++) {
        const xc = (simplifiedPoints[i].x + simplifiedPoints[i + 1].x) / 2;
        const yc = (simplifiedPoints[i].y + simplifiedPoints[i + 1].y) / 2;
        ctx.quadraticCurveTo(simplifiedPoints[i].x, simplifiedPoints[i].y, xc, yc);
    }
    ctx.quadraticCurveTo(
        simplifiedPoints[i].x, simplifiedPoints[i].y,
        simplifiedPoints[i + 1].x, simplifiedPoints[i + 1].y
    );
    ctx.stroke();
}

function drawLiveOverlays() {
    clearLiveOverlay();
    liveCtx.save();
    applyViewportTransform(liveCtx);
    configureContext(liveCtx);

    const styles = getComputedStyle(document.body);

    if (currentTool === 'draw' && isPointerActive && pointerPoints.length >= 2) {
        liveCtx.strokeStyle = currentColor;
        liveCtx.lineWidth = currentLineWidth;
        liveCtx.shadowColor = currentColor;
        drawSmoothedCurve(liveCtx, pointerPoints);
    } else if (currentTool === 'draw' && isPointerActive && pointerPoints.length === 1) {
        liveCtx.fillStyle = currentColor;
        liveCtx.beginPath();
        liveCtx.arc(pointerPoints[0].x, pointerPoints[0].y, currentLineWidth / 2, 0, 2 * Math.PI);
        liveCtx.fill();
    }

    if (cropRect && currentTool === 'crop') {
        liveCtx.setLineDash([8 / viewport.scale, 6 / viewport.scale]);
        liveCtx.lineWidth = 1.5 / viewport.scale;
        liveCtx.strokeStyle = styles.getPropertyValue('--selection').trim() || '#ffffff';
        liveCtx.fillStyle = styles.getPropertyValue('--selection-fill').trim() || 'rgba(255,255,255,0.12)';
        liveCtx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
        liveCtx.fillRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
    }

    if (selectionBox && currentTool === 'edit') {
        liveCtx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
        liveCtx.lineWidth = 1 / viewport.scale;
        liveCtx.strokeStyle = styles.getPropertyValue('--object-selection').trim() || '#818cf8';
        liveCtx.fillStyle = styles.getPropertyValue('--object-selection-fill').trim() || 'rgba(129,140,248,0.1)';
        liveCtx.strokeRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height);
        liveCtx.fillRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height);
    }

    if (currentTool === 'edit') {
        selectedShapeIds.forEach(id => {
            const shape = getShapeById(id);
            if (!shape || !shape.controlPoints?.length) return;
            const bounds = getShapeBounds(shape);
            liveCtx.setLineDash([4 / viewport.scale, 4 / viewport.scale]);
            liveCtx.lineWidth = 1 / viewport.scale;
            liveCtx.strokeStyle = styles.getPropertyValue('--object-selection').trim() || '#818cf8';
            liveCtx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            drawShapeHandles(liveCtx, shape);
        });
    }

    liveCtx.restore();
}

function drawShapeHandles(ctx, shape) {
    if (!shape.controlPoints?.length) return;
    const styles = getComputedStyle(document.body);
    const fill = styles.getPropertyValue('--handle-fill').trim() || '#ffffff';
    const stroke = styles.getPropertyValue('--handle-stroke').trim() || '#6366f1';
    const r = Math.max(4, HANDLE_VISUAL_RADIUS) / viewport.scale;

    shape.controlPoints.forEach(pt => {
        ctx.beginPath();
        ctx.setLineDash([]);
        ctx.arc(pt.x, pt.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2 / viewport.scale;
        ctx.stroke();
    });
}

// ─── Hit testing & bounds ────────────────────────────────────────────────────

function getShapeBounds(shape) {
    if (shape.type === 'text') {
        const pos = getTextPosition(shape);
        const cacheKey = getTextShapeCacheKey(shape);
        const renderData = textRenderCache.get(cacheKey);
        const w = shape.maxWidth || (renderData?.width ?? measureTextWidth(shape.text, shape.fontSize));
        const h = renderData?.height ?? shape.fontSize * 1.35 * shape.text.split(/\r?\n/).length;
        return { x: pos.x, y: pos.y, width: w, height: h };
    }
    if (shape.type === 'line') {
        const start = pointByRole(shape, 'start');
        const end = pointByRole(shape, 'end');
        if (!start || !end) return { x: 0, y: 0, width: 0, height: 0 };
        const pad = shape.lineWidth;
        return {
            x: Math.min(start.x, end.x) - pad,
            y: Math.min(start.y, end.y) - pad,
            width: Math.abs(end.x - start.x) + pad * 2,
            height: Math.abs(end.y - start.y) + pad * 2
        };
    }
    if (shape.type === 'rect') {
        const rect = getRectFromCorners(shape.controlPoints);
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    if (shape.type === 'circle') {
        const center = pointByRole(shape, 'center');
        const radiusPt = pointByRole(shape, 'radius');
        const r = center && radiusPt ? Math.hypot(radiusPt.x - center.x, radiusPt.y - center.y) : 0;
        return { x: center.x - r, y: center.y - r, width: r * 2, height: r * 2 };
    }
    if (shape.type === 'ellipse') {
        const { centerX, centerY, radiusX, radiusY } = getEllipseParams(shape);
        return { x: centerX - radiusX, y: centerY - radiusY, width: radiusX * 2, height: radiusY * 2 };
    }
    const pts = shape.displayMode === 'prototype' && shape.smoothedPoints?.length
        ? shape.smoothedPoints
        : (anchors(shape).length ? anchors(shape) : shape.smoothedPoints || []);
    if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function hitTestShape(coords, shape, tolerance) {
    const bounds = getShapeBounds(shape);
    const pad = tolerance + shape.lineWidth;

    if (shape.type === 'line') {
        const start = pointByRole(shape, 'start');
        const end = pointByRole(shape, 'end');
        return start && end && distToSegment(coords, start, end) <= pad;
    }
    if (shape.type === 'rect') {
        const r = getRectFromCorners(shape.controlPoints);
        return coords.x >= r.x - pad && coords.x <= r.x + r.width + pad
            && coords.y >= r.y - pad && coords.y <= r.y + r.height + pad;
    }
    if (shape.type === 'circle') {
        const center = pointByRole(shape, 'center');
        const radiusPt = pointByRole(shape, 'radius');
        const r = Math.hypot(radiusPt.x - center.x, radiusPt.y - center.y);
        const d = Math.hypot(coords.x - center.x, coords.y - center.y);
        return Math.abs(d - r) <= pad || d < r;
    }
    if (shape.type === 'ellipse') {
        const { centerX, centerY, radiusX, radiusY, rotation } = getEllipseParams(shape);
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        const lx = coords.x - centerX;
        const ly = coords.y - centerY;
        const nx = (lx * cos - ly * sin) / Math.max(1, radiusX);
        const ny = (ly * cos + lx * sin) / Math.max(1, radiusY);
        const val = nx * nx + ny * ny;
        return val <= 1.2;
    }
    if (shape.type === 'text') {
        return coords.x >= bounds.x && coords.x <= bounds.x + bounds.width
            && coords.y >= bounds.y && coords.y <= bounds.y + bounds.height;
    }
    const pts = shape.displayMode === 'prototype' && shape.smoothedPoints?.length
        ? shape.smoothedPoints : (anchors(shape).length ? anchors(shape) : shape.smoothedPoints || []);
    for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(coords, pts[i], pts[i + 1]) <= pad) return true;
    }
    return coords.x >= bounds.x - pad && coords.x <= bounds.x + bounds.width + pad
        && coords.y >= bounds.y - pad && coords.y <= bounds.y + bounds.height + pad;
}

function hitTestHandle(coords) {
    const hitR = getHandleHitRadius() / viewport.scale;
    for (let i = shapes.length - 1; i >= 0; i--) {
        const shape = migrateLegacyShape(shapes[i]);
        shapes[i] = shape;
        if (!selectedShapeIds.has(shape.id)) continue;
        for (let j = 0; j < shape.controlPoints.length; j++) {
            const pt = shape.controlPoints[j];
            if (Math.hypot(coords.x - pt.x, coords.y - pt.y) <= hitR) {
                return { shapeId: shape.id, handleIndex: j };
            }
        }
    }
    return null;
}

function getTopShapeAtPoint(coords) {
    for (let i = shapes.length - 1; i >= 0; i--) {
        const shape = migrateLegacyShape(shapes[i]);
        shapes[i] = shape;
        if (hitTestShape(coords, shape, 10)) return shape;
    }
    return null;
}

function shapesInRect(rect) {
    const normalized = normalizeRect(rect.start || { x: rect.x, y: rect.y }, rect.end || { x: rect.x + rect.width, y: rect.y + rect.height });
    const found = [];
    shapes.forEach(shape => {
        const b = getShapeBounds(shape);
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        if (cx >= normalized.x && cx <= normalized.x + normalized.width
            && cy >= normalized.y && cy <= normalized.y + normalized.height) {
            found.push(shape.id);
        }
    });
    return found;
}

// ─── Geometry detection (RDP) ────────────────────────────────────────────────

function getPerpendicularDistance(p, p1, p2) {
    if (p1.x === p2.x && p1.y === p2.y) return Math.hypot(p.x - p1.x, p.y - p1.y);
    const num = Math.abs((p2.y - p1.y) * p.x - (p2.x - p1.x) * p.y + p2.x * p1.y - p2.y * p1.x);
    const den = Math.hypot(p2.y - p1.y, p2.x - p1.x);
    return num / den;
}

function rdp(pointsList, epsilon) {
    if (pointsList.length < 3) return pointsList;
    let maxDistance = 0;
    let index = 0;
    const end = pointsList.length - 1;
    for (let i = 1; i < end; i++) {
        const distance = getPerpendicularDistance(pointsList[i], pointsList[0], pointsList[end]);
        if (distance > maxDistance) { maxDistance = distance; index = i; }
    }
    if (maxDistance > epsilon) {
        const r1 = rdp(pointsList.slice(0, index + 1), epsilon);
        const r2 = rdp(pointsList.slice(index), epsilon);
        return r1.slice(0, r1.length - 1).concat(r2);
    }
    return [pointsList[0], pointsList[end]];
}

function isLine(rdpPoints) { return rdpPoints.length <= 3; }

function getCornerAnalysis(points) {
    if (points.length < 4) return { rightAngleCorners: 0, significantCorners: 0, cornerStrength: 0 };
    const analysisPoints = points.slice();
    const first = analysisPoints[0];
    const last = analysisPoints[analysisPoints.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) < 10) analysisPoints.pop();
    if (analysisPoints.length < 4) return { rightAngleCorners: 0, significantCorners: 0, cornerStrength: 0 };

    let rightAngleCorners = 0, significantCorners = 0, cornerStrength = 0;
    const len = analysisPoints.length;
    for (let i = 0; i < len; i++) {
        const p1 = analysisPoints[(i - 1 + len) % len];
        const p2 = analysisPoints[i];
        const p3 = analysisPoints[(i + 1) % len];
        const ux = p1.x - p2.x, uy = p1.y - p2.y;
        const vx = p3.x - p2.x, vy = p3.y - p2.y;
        const uMag = Math.hypot(ux, uy), vMag = Math.hypot(vx, vy);
        if (uMag < 6 || vMag < 6) continue;
        const cosTheta = (ux * vx + uy * vy) / (uMag * vMag);
        const angle = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * (180 / Math.PI);
        const significance = Math.min(uMag, vMag);
        if (angle >= 55 && angle <= 125) { rightAngleCorners++; cornerStrength += significance; }
        if (angle >= 40 && angle <= 140 && significance >= 10) significantCorners++;
    }
    return { rightAngleCorners, significantCorners, cornerStrength };
}

function isRectangle(rdpPoints) {
    if (rdpPoints.length < 4 || rdpPoints.length > 9) return false;
    const first = rdpPoints[0];
    const last = rdpPoints[rdpPoints.length - 1];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    rdpPoints.forEach(p => {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    const width = maxX - minX, height = maxY - minY;
    const perimeter = 2 * (width + height);
    if (width < 12 || height < 12) return false;
    if (Math.hypot(last.x - first.x, last.y - first.y) > perimeter * 0.28) return false;
    const cornerAnalysis = getCornerAnalysis(rdpPoints);
    const minEdgeDistance = Math.max(6, Math.min(width, height) * 0.12);
    let edgeAlignedPoints = 0;
    rdpPoints.forEach(p => {
        if (Math.abs(p.x - minX) <= minEdgeDistance || Math.abs(p.x - maxX) <= minEdgeDistance
            || Math.abs(p.y - minY) <= minEdgeDistance || Math.abs(p.y - maxY) <= minEdgeDistance) edgeAlignedPoints++;
    });
    return cornerAnalysis.rightAngleCorners >= 3 && cornerAnalysis.significantCorners >= 3
        && edgeAlignedPoints >= Math.max(4, rdpPoints.length - 1);
}

function getClosedShapeMetrics(rawPoints) {
    let sumX = 0, sumY = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    rawPoints.forEach(p => {
        sumX += p.x; sumY += p.y;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    const first = rawPoints[0], last = rawPoints[rawPoints.length - 1];
    return {
        centerX: sumX / rawPoints.length, centerY: sumY / rawPoints.length,
        width: maxX - minX, height: maxY - minY,
        gap: Math.hypot(last.x - first.x, last.y - first.y)
    };
}

function isCircle(rawPoints, rdpPoints) {
    if (rdpPoints.length < 4) return false;
    const metrics = getClosedShapeMetrics(rawPoints);
    const aspectRatio = Math.max(metrics.width, metrics.height) / Math.max(1, Math.min(metrics.width, metrics.height));
    if (aspectRatio > 1.18) return false;
    let totalRadius = 0;
    const radii = rawPoints.map(p => {
        const dist = Math.hypot(p.x - metrics.centerX, p.y - metrics.centerY);
        totalRadius += dist;
        return dist;
    });
    const meanRadius = totalRadius / rawPoints.length;
    let varianceSum = 0;
    radii.forEach(r => { varianceSum += Math.pow(r - meanRadius, 2); });
    const stdDev = Math.sqrt(varianceSum / rawPoints.length);
    return (stdDev / meanRadius < 0.20 + rdpEpsilon * 0.02) && (metrics.gap < meanRadius * 1.8);
}

function isEllipse(rawPoints, rdpPoints) {
    if (rdpPoints.length < 5) return false;
    const metrics = getClosedShapeMetrics(rawPoints);
    const cornerAnalysis = getCornerAnalysis(rdpPoints);
    const radiusX = metrics.width / 2, radiusY = metrics.height / 2;
    if (radiusX < 8 || radiusY < 8) return false;
    if (Math.abs(radiusX - radiusY) < Math.max(radiusX, radiusY) * 0.12) return false;
    if (metrics.gap > Math.max(radiusX, radiusY) * 1.8) return false;
    if (cornerAnalysis.rightAngleCorners >= 3 || cornerAnalysis.significantCorners >= 4) return false;
    let varianceSum = 0;
    rawPoints.forEach(p => {
        const nx = (p.x - metrics.centerX) / radiusX;
        const ny = (p.y - metrics.centerY) / radiusY;
        varianceSum += Math.pow(Math.sqrt(nx * nx + ny * ny) - 1, 2);
    });
    return Math.sqrt(varianceSum / rawPoints.length) < 0.24;
}

function createShapeFromPoints(rawPoints) {
    const simplified = rdp(rawPoints, rdpEpsilon);
    const storedRaw = cloneData(rawPoints);
    const storedSmooth = cloneData(simplified);

    const base = {
        id: createShapeId(),
        color: currentColor,
        lineWidth: currentLineWidth,
        displayMode: 'normalized',
        rawPoints: storedRaw,
        smoothedPoints: storedSmooth,
        userEdited: false
    };

    if (smartModeCheckbox.checked) {
        if (isLine(simplified)) {
            const start = rawPoints[0];
            const end = rawPoints[rawPoints.length - 1];
            return {
                ...base,
                type: 'line',
                normalizedType: 'line',
                controlPoints: buildLineControlPoints(start, end),
                message: `Straight line detected. RDP simplified ${rawPoints.length} points to ${simplified.length}. Press Z to see prototype.`
            };
        }
        if (isRectangle(simplified)) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            rawPoints.forEach(p => {
                if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            });
            return {
                ...base,
                type: 'rect',
                normalizedType: 'rect',
                controlPoints: buildRectControlPoints(minX, minY, maxX - minX, maxY - minY),
                message: `Rectangle detected. Press Z to see smoothed prototype.`
            };
        }
        if (isEllipse(rawPoints, simplified)) {
            const { centerX, centerY, width, height } = getClosedShapeMetrics(rawPoints);
            return {
                ...base,
                type: 'ellipse',
                normalizedType: 'ellipse',
                controlPoints: buildEllipseControlPoints(centerX, centerY, width / 2, height / 2, 0),
                message: `Ellipse detected. Press Z to see smoothed prototype.`
            };
        }
        if (isCircle(rawPoints, simplified)) {
            const { centerX, centerY } = getClosedShapeMetrics(rawPoints);
            let totalRadius = 0;
            rawPoints.forEach(p => { totalRadius += Math.hypot(p.x - centerX, p.y - centerY); });
            const meanRadius = totalRadius / rawPoints.length;
            return {
                ...base,
                type: 'circle',
                normalizedType: 'circle',
                controlPoints: buildCircleControlPoints(centerX, centerY, meanRadius),
                message: `Circle detected. Press Z to see smoothed prototype.`
            };
        }
    }

    return {
        ...base,
        type: 'curve',
        normalizedType: null,
        controlPoints: buildCurveControlPoints(simplified),
        message: smartModeCheckbox.checked
            ? `Freeform curve. Bezier smoothing removed ${Math.round((1 - simplified.length / rawPoints.length) * 100)}% of points.`
            : `Curve smoothing removed ${Math.round((1 - simplified.length / rawPoints.length) * 100)}% of points.`
    };
}

// ─── Handle drag constraints ─────────────────────────────────────────────────

function updateShapeFromHandle(shape, handleIndex, coords) {
    const pt = shape.controlPoints[handleIndex];
    pt.x = coords.x;
    pt.y = coords.y;
    shape.userEdited = true;

    if (shape.type === 'rect') {
        const tl = pointByRole(shape, 'cornerTL');
        const tr = pointByRole(shape, 'cornerTR');
        const br = pointByRole(shape, 'cornerBR');
        const bl = pointByRole(shape, 'cornerBL');
        const role = pt.role;
        if (role === 'cornerTL') { tr.y = pt.y; bl.x = pt.x; }
        else if (role === 'cornerTR') { tl.y = pt.y; br.x = pt.x; }
        else if (role === 'cornerBR') { tr.x = pt.x; bl.y = pt.y; }
        else if (role === 'cornerBL') { tl.x = pt.x; br.y = pt.y; }
    } else if (shape.type === 'text' && pt.role === 'widthHandle') {
        const topLeft = pointByRole(shape, 'topLeft');
        if (coords.x < topLeft.x + 40) pt.x = topLeft.x + 40;
        pt.y = topLeft.y;
        syncTextMaxWidthFromHandles(shape);
        textRenderCache.delete(getTextShapeCacheKey(shape));
    } else if (shape.type === 'curve' && pt.role === 'anchor') {
        const idx = shape.controlPoints.filter(p => p.role === 'anchor').indexOf(pt);
        if (shape.smoothedPoints && shape.smoothedPoints[idx]) {
            shape.smoothedPoints[idx].x = coords.x;
            shape.smoothedPoints[idx].y = coords.y;
        }
    }
}

function snapshotShapeControlPoints(shapeIds) {
    const snap = {};
    shapeIds.forEach(id => {
        const s = getShapeById(id);
        if (s) snap[id] = cloneData(s.controlPoints);
    });
    return snap;
}

// ─── Clipboard ───────────────────────────────────────────────────────────────

function copySelectedShapes() {
    if (selectedShapeIds.size === 0) return;
    internalClipboard = [...selectedShapeIds].map(id => cloneShape(getShapeById(id)));
    logStatus(`Copied ${internalClipboard.length} object(s). Ctrl+V to paste.`);
}

function pasteShapes() {
    if (!internalClipboard?.length) return;
    pushUndoState();
    const clones = internalClipboard.map(s => cloneShapeWithNewId(s, PASTE_OFFSET, PASTE_OFFSET));
    shapes.push(...clones);
    selectedShapeIds = new Set(clones.map(s => s.id));
    renderScene();
    updateActionButtons();
    logStatus(`Pasted ${clones.length} object(s).`);
}

function duplicateSelectedShapes() {
    if (selectedShapeIds.size === 0) return;
    copySelectedShapes();
    pasteShapes();
}

function deleteSelectedShapes() {
    if (selectedShapeIds.size === 0) return;
    const count = selectedShapeIds.size;
    pushUndoState();
    shapes = shapes.filter(shape => !selectedShapeIds.has(shape.id));
    clearObjectSelection();
    renderScene();
    logStatus(`Deleted ${count} object(s).`);
}

// ─── Coords & text editor ────────────────────────────────────────────────────

function normalizeRect(start, end) {
    return {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y)
    };
}

function getScreenCoords(e) {
    const rect = liveCanvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches?.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
}

function getEventCoords(e) {
    return screenToWorld(getScreenCoords(e));
}

function showTextEditorPopup(worldCoords) {
    const screen = worldToScreen(worldCoords);
    pendingTextPlacement = worldCoords;
    const popupWidth = 320;
    const popupHeight = 220;
    const maxLeft = Math.max(12, liveCanvas.clientWidth - popupWidth - 12);
    const maxTop = Math.max(12, liveCanvas.clientHeight - popupHeight - 12);
    textEditorPopup.style.left = `${Math.min(screen.x, maxLeft)}px`;
    textEditorPopup.style.top = `${Math.min(screen.y, maxTop)}px`;
    textEditorPopup.classList.remove('hidden');
    void updateTextPreview();
    textInput.focus();
    textInput.select();
}

function hideTextEditorPopup() {
    pendingTextPlacement = null;
    editingTextShapeId = null;
    textEditorPopup.classList.add('hidden');
}

async function updateTextPreview() {
    const content = textInput.value;
    const fontSize = Math.max(12, Math.min(96, parseInt(textSizeInput.value, 10) || 22));
    textPreview.style.fontSize = `${fontSize}px`;
    textPreview.innerHTML = '';
    if (!content.trim()) {
        textPreview.textContent = 'Preview will appear here.';
        return;
    }
    if (isBlockFormula(content)) {
        await waitForMathJax();
        if (window.MathJax?.tex2svgPromise) {
            const node = await window.MathJax.tex2svgPromise(unwrapBlockFormula(content), { display: true });
            textPreview.appendChild(node);
            return;
        }
    }
    for (const block of parseTextBlocks(content)) {
        const div = document.createElement('div');
        div.style.minHeight = `${fontSize * 1.3}px`;
        if (block.type === 'block-formula') {
            await waitForMathJax();
            if (window.MathJax?.tex2svgPromise) {
                div.appendChild(await window.MathJax.tex2svgPromise(block.content, { display: true }));
                textPreview.appendChild(div);
                continue;
            }
        }

        const segments = parseLineSegments(block.content);
        for (const segment of segments) {
            if (segment.type === 'formula') {
                await waitForMathJax();
                if (window.MathJax?.tex2svgPromise) {
                    div.appendChild(await window.MathJax.tex2svgPromise(segment.content, { display: false }));
                    continue;
                }
            }
            div.appendChild(document.createTextNode(segment.content));
        }
        if (!block.content) div.innerHTML = '&nbsp;';
        textPreview.appendChild(div);
    }
}

function createTextShape(worldCoords) {
    const content = textInput.value.trim();
    if (!content) {
        logStatus('Type some text first. Use $...$ for math.');
        return null;
    }
    const fontSize = Math.max(12, Math.min(96, parseInt(textSizeInput.value, 10) || 22));
    const naturalWidth = measureTextWidth(content.split(/\r?\n/)[0], fontSize);
    const maxWidth = Math.max(naturalWidth, 80);
    return {
        id: createShapeId(),
        type: 'text',
        color: currentColor,
        fontSize,
        text: content,
        maxWidth,
        displayMode: 'normalized',
        controlPoints: buildTextControlPoints(worldCoords.x, worldCoords.y, maxWidth),
        rawPoints: null,
        smoothedPoints: null,
        normalizedType: null,
        userEdited: false,
        message: 'Text inserted on the canvas.'
    };
}

function commitTextPlacement() {
    if (!pendingTextPlacement) return;
    const textShape = createTextShape(pendingTextPlacement);
    if (!textShape) return;

    pushUndoState();
    if (editingTextShapeId) {
        const idx = shapes.findIndex(s => s.id === editingTextShapeId);
        if (idx >= 0) {
            textRenderCache.delete(getTextShapeCacheKey(shapes[idx]));
            textShape.id = editingTextShapeId;
            shapes[idx] = textShape;
        }
    } else {
        shapes.push(textShape);
    }
    hideTextEditorPopup();
    void prepareTextRenderData(textShape).then(() => renderScene());
    renderScene();
    logStatus(textShape.message);
}

function getTextShapeAtPoint(coords) {
    for (let i = shapes.length - 1; i >= 0; i--) {
        const shape = shapes[i];
        if (shape.type !== 'text') continue;
        if (hitTestShape(coords, shape, 4)) return { shape, index: i };
    }
    return null;
}

function openTextEditorForShape(shapeInfo) {
    editingTextShapeId = shapeInfo.shape.id;
    textInput.value = shapeInfo.shape.text;
    textSizeInput.value = shapeInfo.shape.fontSize;
    const pos = getTextPosition(shapeInfo.shape);
    showTextEditorPopup({ x: pos.x, y: pos.y });
    logStatus('Editing existing text. Update content or size, then insert.');
}

// ─── Pointer handling ────────────────────────────────────────────────────────

function startPointer(e) {
    if (suppressNextStroke) {
        suppressNextStroke = false;
        return;
    }
    if (touchMode === 'pinch') return;

    const coords = getEventCoords(e);

    if (currentTool === 'crop') {
        isPointerActive = true;
        cropStart = coords;
        cropRect = { x: coords.x, y: coords.y, width: 0, height: 0 };
        clearObjectSelection();
        drawLiveOverlays();
        return;
    }

    if (currentTool === 'edit') {
        const handleHit = hitTestHandle(coords);
        if (handleHit) {
            isPointerActive = true;
            dragState = {
                kind: 'handle',
                shapeId: handleHit.shapeId,
                handleIndex: handleHit.handleIndex,
                startCoords: coords,
                snapshot: snapshotShapeControlPoints([handleHit.shapeId])
            };
            return;
        }

        const hit = getTopShapeAtPoint(coords);
        if (hit) {
            if (e.shiftKey) {
                if (selectedShapeIds.has(hit.id)) selectedShapeIds.delete(hit.id);
                else selectedShapeIds.add(hit.id);
            } else if (!selectedShapeIds.has(hit.id)) {
                selectedShapeIds.clear();
                selectedShapeIds.add(hit.id);
            }

            if (selectedShapeIds.has(hit.id)) {
                isPointerActive = true;
                dragState = {
                    kind: 'move',
                    shapeIds: [...selectedShapeIds],
                    startCoords: coords,
                    lastCoords: coords,
                    snapshot: snapshotShapeControlPoints([...selectedShapeIds])
                };
                updateActionButtons();
                drawLiveOverlays();
                return;
            }
        }

        if (!e.shiftKey) clearObjectSelection();
        isPointerActive = true;
        selectionBoxStart = coords;
        selectionBox = { x: coords.x, y: coords.y, width: 0, height: 0 };
        drawLiveOverlays();
        return;
    }

    if (currentTool === 'text') {
        clearSelection();
        const textShapeInfo = getTextShapeAtPoint(coords);
        if (textShapeInfo) {
            if (e.detail >= 2) openTextEditorForShape(textShapeInfo);
            return;
        }
        editingTextShapeId = null;
        textInput.value = '';
        textSizeInput.value = '22';
        showTextEditorPopup(coords);
        logStatus('Text editor opened. Set the size and content, then insert.');
        return;
    }

    if (currentTool === 'draw') {
        isPointerActive = true;
        pointerPoints = [coords];
        clearCropSelection();
        clearObjectSelection();
        drawLiveOverlays();
    }
}

function movePointer(e) {
    if (!isPointerActive || touchMode === 'pinch') return;
    e.preventDefault();
    const coords = getEventCoords(e);

    if (currentTool === 'crop') {
        cropRect = normalizeRect(cropStart, coords);
        drawLiveOverlays();
        updateActionButtons();
        return;
    }

    if (currentTool === 'edit' && dragState) {
        if (dragState.kind === 'handle') {
            const shape = getShapeById(dragState.shapeId);
            if (shape) {
                updateShapeFromHandle(shape, dragState.handleIndex, coords);
                drawLiveOverlays();
                renderScene();
            }
        } else if (dragState.kind === 'move') {
            const dx = coords.x - dragState.lastCoords.x;
            const dy = coords.y - dragState.lastCoords.y;
            dragState.shapeIds.forEach(id => {
                const shape = getShapeById(id);
                if (shape) translateShape(shape, dx, dy);
            });
            dragState.lastCoords = coords;
            drawLiveOverlays();
            renderScene();
        }
        return;
    }

    if (currentTool === 'edit' && selectionBoxStart) {
        selectionBox = normalizeRect(selectionBoxStart, coords);
        drawLiveOverlays();
        return;
    }

    if (currentTool === 'draw') {
        pointerPoints.push(coords);
        drawLiveOverlays();
    }
}

function stopPointer() {
    if (!isPointerActive) return;
    isPointerActive = false;

    if (currentTool === 'crop') {
        if (cropRect && (cropRect.width < 4 || cropRect.height < 4)) clearCropSelection();
        else drawLiveOverlays();
        updateActionButtons();
        if (cropRect) logStatus('Crop region ready. Copy as PNG.');
        return;
    }

    if (currentTool === 'edit') {
        if (dragState) {
            const moved = dragState.kind === 'move'
                && (dragState.lastCoords.x !== dragState.startCoords.x || dragState.lastCoords.y !== dragState.startCoords.y);
            const handleMoved = dragState.kind === 'handle';
            if (moved || handleMoved) pushUndoState();
            dragState = null;
        } else if (selectionBoxStart && selectionBox) {
            if (selectionBox.width > 4 && selectionBox.height > 4) {
                const ids = shapesInRect({ start: selectionBoxStart, end: {
                    x: selectionBox.x + selectionBox.width,
                    y: selectionBox.y + selectionBox.height
                }});
                selectedShapeIds = new Set(ids);
                logStatus(`Selected ${ids.length} object(s).`);
            }
            selectionBoxStart = null;
            selectionBox = null;
        }
        updateActionButtons();
        drawLiveOverlays();
        return;
    }

    clearLiveOverlay();
    if (pointerPoints.length < 2) {
        pointerPoints = [];
        drawLiveOverlays();
        return;
    }

    pushUndoState();
    const shape = createShapeFromPoints(pointerPoints);
    shapes.push(shape);
    selectedShapeIds.clear();
    selectedShapeIds.add(shape.id);
    pointerPoints = [];
    renderScene();
    updateActionButtons();
    logStatus(shape.message + (currentTool === 'draw' ? ' Switch to Edit to adjust handles.' : ''));
}

async function copyCropToClipboard() {
    if (!cropRect) return;

    const offscreen = document.createElement('canvas');
    const w = Math.max(1, Math.round(cropRect.width * dpr * viewport.scale));
    const h = Math.max(1, Math.round(cropRect.height * dpr * viewport.scale));
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');

    ctx.fillStyle = currentBackground === 'white' ? '#ffffff' : '#020617';
    ctx.fillRect(0, 0, w, h);
    ctx.scale(viewport.scale * dpr, viewport.scale * dpr);
    ctx.translate(-cropRect.x, -cropRect.y);
    shapes.forEach(shape => drawShape(ctx, shape));

    if (!navigator.clipboard?.write || !window.ClipboardItem) {
        logStatus('This browser does not support copying images to the clipboard.');
        return;
    }
    try {
        const blob = await new Promise(resolve => offscreen.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('toBlob failed');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        logStatus('Crop region copied to clipboard as PNG.');
    } catch {
        logStatus('Clipboard write failed. Use localhost or HTTPS.');
    }
}

function setBackground(mode) {
    if (currentBackground === mode) return;
    pushUndoState();
    currentBackground = mode;
    applyBackgroundTheme();
    renderScene();
    logStatus(`Canvas background switched to ${mode === 'white' ? 'white' : 'black'}.`);
}

function clearCanvas() {
    if (!shapes.length && currentBackground === 'white') return;
    pushUndoState();
    shapes = [];
    clearSelection();
    renderScene();
    logStatus('Canvas cleared.');
}

function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshotState());
    restoreSnapshot(undoStack.pop());
    logStatus('Last action undone.');
}

function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshotState());
    restoreSnapshot(redoStack.pop());
    logStatus('Last undone action restored.');
}

function handleKeyboardShortcuts(e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const modifier = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (!modifier && key === 'z' && currentTool === 'edit') {
        if (toggleDisplayModeForSelection()) e.preventDefault();
        return;
    }

    if (!modifier && key === 'escape') {
        clearSelection();
        renderScene();
        return;
    }

    if (!modifier && (key === 'delete' || key === 'backspace')) {
        if (selectedShapeIds.size > 0) {
            e.preventDefault();
            deleteSelectedShapes();
        }
        return;
    }

    if (!modifier) return;

    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }

    if (key === 'c') {
        if (selectedShapeIds.size > 0) {
            e.preventDefault();
            copySelectedShapes();
        } else if (cropRect) {
            e.preventDefault();
            copyCropToClipboard();
        }
        return;
    }
    if (key === 'v' && internalClipboard?.length) {
        e.preventDefault();
        pasteShapes();
        return;
    }
    if (key === 'd' && selectedShapeIds.size > 0) {
        e.preventDefault();
        duplicateSelectedShapes();
    }
}

function handleWheel(e) {
    if (isMobileViewport() && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const screen = getScreenCoords(e);
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomAt(factor, screen.x, screen.y);
}

function handleTouchStart(e) {
    if (e.touches.length === 2) {
        touchMode = 'pinch';
        isPointerActive = false;
        pointerPoints = [];
        dragState = null;
        pinchState = {
            distance: getTouchDistance(e.touches),
            scale: viewport.scale,
            midpoint: getTouchMidpointScreen(e.touches)
        };
        e.preventDefault();
        return;
    }
    if (e.touches.length === 1 && touchMode !== 'pinch') {
        startPointer(e);
        e.preventDefault();
    }
}

function handleTouchMove(e) {
    if (touchMode === 'pinch' && e.touches.length === 2 && pinchState) {
        const dist = getTouchDistance(e.touches);
        const midpoint = getTouchMidpointScreen(e.touches);
        const factor = dist / pinchState.distance;
        const targetScale = clampZoom(pinchState.scale * factor);
        const worldBefore = screenToWorld(midpoint);
        viewport.scale = targetScale;
        viewport.offsetX = midpoint.x - worldBefore.x * targetScale;
        viewport.offsetY = midpoint.y - worldBefore.y * targetScale;
        updateZoomLabel();
        renderScene();
        e.preventDefault();
        return;
    }
    if (touchMode !== 'pinch') movePointer(e);
}

function handleTouchEnd(e) {
    if (touchMode === 'pinch') {
        if (e.touches.length < 2) {
            touchMode = null;
            pinchState = null;
            suppressNextStroke = true;
        }
        return;
    }
    stopPointer();
}

// ─── Event bindings ──────────────────────────────────────────────────────────

brushSizeInput.addEventListener('input', e => {
    currentLineWidth = parseInt(e.target.value, 10);
    brushSizeVal.innerText = currentLineWidth + 'px';
});
toleranceInput.addEventListener('input', e => {
    rdpEpsilon = parseFloat(e.target.value);
    toleranceVal.innerText = rdpEpsilon.toFixed(1) + 'px';
});

clearBtn.addEventListener('click', clearCanvas);
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
copySelectionBtn.addEventListener('click', copyCropToClipboard);
duplicateBtn.addEventListener('click', duplicateSelectedShapes);
drawToolBtn.addEventListener('click', () => setTool('draw'));
textToolBtn.addEventListener('click', () => setTool('text'));
editToolBtn.addEventListener('click', () => setTool('edit'));
cropToolBtn.addEventListener('click', () => setTool('crop'));
bgWhiteBtn.addEventListener('click', () => setBackground('white'));
bgBlackBtn.addEventListener('click', () => setBackground('black'));
insertTextBtn.addEventListener('click', commitTextPlacement);
cancelTextBtn.addEventListener('click', () => {
    hideTextEditorPopup();
    logStatus('Text insertion cancelled.');
});
textInput.addEventListener('input', () => { void updateTextPreview(); });
textSizeInput.addEventListener('input', () => { void updateTextPreview(); });

zoomSlider?.addEventListener('input', e => {
    const nextScale = (parseInt(e.target.value, 10) || 100) / 100;
    setZoomScale(nextScale);
});
zoomInBtnMobile?.addEventListener('click', zoomIn);
zoomOutBtnMobile?.addEventListener('click', zoomOut);

window.addEventListener('resize', resizeCanvases);
window.addEventListener('keydown', handleKeyboardShortcuts);
liveCanvas.addEventListener('wheel', handleWheel, { passive: false });

liveCanvas.addEventListener('mousedown', startPointer);
liveCanvas.addEventListener('mousemove', movePointer);
liveCanvas.addEventListener('dblclick', e => {
    const coords = getEventCoords(e);
    const shapeInfo = getTextShapeAtPoint(coords);
    if (!shapeInfo) return;
    setTool('text');
    openTextEditorForShape(shapeInfo);
});
window.addEventListener('mouseup', stopPointer);

liveCanvas.addEventListener('touchstart', handleTouchStart, { passive: false });
liveCanvas.addEventListener('touchmove', handleTouchMove, { passive: false });
window.addEventListener('touchend', handleTouchEnd);
window.addEventListener('touchcancel', handleTouchEnd);

applyBackgroundTheme();
layoutToolbar();
initColorPalette();
setTool('draw');
zoomReset();
updateActionButtons();
resizeCanvases();
