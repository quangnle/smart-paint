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
const drawToolBtn = document.getElementById('drawToolBtn');
const textToolBtn = document.getElementById('textToolBtn');
const selectToolBtn = document.getElementById('selectToolBtn');
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

const colors = [
    '#f87171', '#fb923c', '#facc15', '#4ade80',
    '#2dd4bf', '#38bdf8', '#6366f1', '#c084fc',
    '#f472b6', '#cbd5e1', '#ffffff', '#000000'
];

let currentLineWidth = 4;
let rdpEpsilon = 2.0;
let currentColor = '#6366f1';
let currentTool = 'draw';
let currentBackground = 'white';
let dpr = window.devicePixelRatio || 1;
let isPointerActive = false;
let pointerPoints = [];
let selectionStart = null;
let selectionRect = null;
let shapes = [];
let undoStack = [];
let redoStack = [];
let mathJaxReadyPromise = null;
let pendingTextPlacement = null;
let editingTextShapeIndex = null;

const textMeasureCanvas = document.createElement('canvas');
const textMeasureCtx = textMeasureCanvas.getContext('2d');
const textRenderCache = new Map();

function updatePaletteButtons() {
    const borderColor = currentBackground === 'white' ? '#0f172a' : '#ffffff';
    Array.from(colorPalette.children).forEach(button => {
        const isSelected = button.dataset.color === currentColor;
        button.style.borderColor = borderColor;
        button.style.borderWidth = isSelected ? '2.5px' : '1px';
    });
}

function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
}

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
    shapes = cloneData(snapshot.shapes);
    currentBackground = snapshot.background;
    applyBackgroundTheme();
    clearSelection();
    renderScene();
    updateActionButtons();
}

function configureContext(ctx) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 0.5;
}

function resizeCanvases() {
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

    liveCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    liveCtx.scale(dpr, dpr);
    mainCtx.scale(dpr, dpr);

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

        if (color === currentColor) {
            button.classList.add('is-selected');
        }

        button.addEventListener('click', () => {
            Array.from(colorPalette.children).forEach(btn => {
                btn.classList.remove('is-selected');
            });

            button.classList.add('is-selected');
            currentColor = color;
            updatePaletteButtons();
            renderScene();
        });

        colorPalette.appendChild(button);
    });

    updatePaletteButtons();
}

function logStatus(message) {
    statusConsole.textContent = message;
}

function updateActionButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
    copySelectionBtn.disabled = !selectionRect;
}

function applyBackgroundTheme() {
    document.body.classList.toggle('theme-light', currentBackground === 'white');
    document.body.classList.toggle('theme-dark', currentBackground === 'black');
    bgWhiteBtn.classList.toggle('is-active', currentBackground === 'white');
    bgBlackBtn.classList.toggle('is-active', currentBackground === 'black');
    updatePaletteButtons();
}

function getTextShapeCacheKey(shape) {
    return JSON.stringify({
        text: shape.text,
        x: shape.x,
        y: shape.y,
        color: shape.color,
        fontSize: shape.fontSize
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
    if (/^\$\$[\s\S]+\$\$$/.test(trimmed)) {
        return trimmed.slice(2, -2).trim();
    }
    if (/^\\\[[\s\S]+\\\]$/.test(trimmed)) {
        return trimmed.slice(2, -2).trim();
    }
    return trimmed;
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

        segments.push({
            type: 'formula',
            content: match[1].slice(1, -1).trim()
        });

        lastIndex = match.index + match[1].length;
    }

    if (lastIndex < line.length) {
        segments.push({ type: 'text', content: line.slice(lastIndex) });
    }

    if (!segments.length) {
        segments.push({ type: 'text', content: '' });
    }

    return segments;
}

function waitForMathJax() {
    if (!window.MathJax || !window.MathJax.startup || !window.MathJax.startup.promise) {
        return Promise.resolve(null);
    }

    if (!mathJaxReadyPromise) {
        mathJaxReadyPromise = window.MathJax.startup.promise;
    }

    return mathJaxReadyPromise;
}

function measureTextWidth(text, fontSize) {
    textMeasureCtx.font = `${fontSize}px 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
    return textMeasureCtx.measureText(text || ' ').width;
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
    if (!window.MathJax || !window.MathJax.tex2svg) {
        return null;
    }

    const wrapper = window.MathJax.tex2svg(formula, { display });
    const svg = wrapper.querySelector('svg');
    if (!svg) {
        return null;
    }

    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.style.color = color;
    svg.setAttribute('fill', color);

    const measureHost = document.createElement('div');
    measureHost.style.position = 'absolute';
    measureHost.style.left = '-9999px';
    measureHost.style.top = '-9999px';
    measureHost.style.visibility = 'hidden';
    measureHost.style.pointerEvents = 'none';
    measureHost.style.fontSize = `${fontSize}px`;
    measureHost.style.color = color;
    measureHost.appendChild(svg.cloneNode(true));
    document.body.appendChild(measureHost);

    const renderedSvg = measureHost.querySelector('svg');
    const rect = renderedSvg.getBoundingClientRect();
    renderedSvg.setAttribute('width', `${Math.max(1, rect.width)}`);
    renderedSvg.setAttribute('height', `${Math.max(1, rect.height)}`);
    renderedSvg.setAttribute('viewBox', renderedSvg.getAttribute('viewBox') || `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
    renderedSvg.style.color = color;
    renderedSvg.setAttribute('fill', color);

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

async function prepareTextRenderData(shape) {
    const cacheKey = getTextShapeCacheKey(shape);
    if (textRenderCache.has(cacheKey)) {
        return textRenderCache.get(cacheKey);
    }

    if (isBlockFormula(shape.text)) {
        const formulaBlock = await renderFormulaLine(unwrapBlockFormula(shape.text), shape.color, shape.fontSize, true);
        if (formulaBlock) {
            const renderData = {
                width: formulaBlock.width,
                height: formulaBlock.height,
                lines: [{
                    type: 'rich-line',
                    width: formulaBlock.width,
                    height: formulaBlock.height,
                    segments: [formulaBlock]
                }]
            };
            textRenderCache.set(cacheKey, renderData);
            return renderData;
        }
    }

    const lines = shape.text.split(/\r?\n/);
    const renderLines = [];

    for (const line of lines) {
        const fullLineFormula = getFormulaMarkup(line);
        if (fullLineFormula) {
            const formulaLine = await renderFormulaLine(fullLineFormula, shape.color, shape.fontSize);
            if (formulaLine) {
                renderLines.push({
                    type: 'rich-line',
                    width: formulaLine.width,
                    height: formulaLine.height,
                    segments: [formulaLine]
                });
                continue;
            }
        }

        const rawSegments = parseLineSegments(line);
        const segments = [];
        let lineWidth = 0;
        let lineHeight = shape.fontSize * 1.35;

        for (const segment of rawSegments) {
            if (segment.type === 'formula') {
                const formulaSegment = await renderFormulaLine(segment.content, shape.color, shape.fontSize);
                if (formulaSegment) {
                    segments.push(formulaSegment);
                    lineWidth += formulaSegment.width;
                    lineHeight = Math.max(lineHeight, formulaSegment.height);
                    continue;
                }
            }

            const textSegment = {
                type: 'text',
                text: segment.content,
                width: measureTextWidth(segment.content, shape.fontSize),
                height: shape.fontSize * 1.35
            };
            segments.push(textSegment);
            lineWidth += textSegment.width;
        }

        renderLines.push({
            type: 'rich-line',
            width: lineWidth,
            height: lineHeight,
            segments
        });
    }

    const renderData = {
        width: renderLines.reduce((maxWidth, line) => Math.max(maxWidth, line.width), 0),
        height: renderLines.reduce((totalHeight, line) => totalHeight + line.height, 0),
        lines: renderLines
    };
    textRenderCache.set(cacheKey, renderData);
    return renderData;
}

function setBackground(mode) {
    if (currentBackground === mode) return;
    pushUndoState();
    currentBackground = mode;
    applyBackgroundTheme();
    renderScene();
    logStatus(`Canvas background switched to ${mode === 'white' ? 'white' : 'black'}.`);
}

function setTool(tool) {
    currentTool = tool;
    drawToolBtn.classList.toggle('is-active', tool === 'draw');
    textToolBtn.classList.toggle('is-active', tool === 'text');
    selectToolBtn.classList.toggle('is-active', tool === 'select');
    liveCanvas.classList.toggle('is-drawing', tool === 'draw');
    liveCanvas.classList.toggle('is-text', tool === 'text');
    liveCanvas.classList.toggle('is-selecting', tool === 'select');

    if (tool === 'draw') {
        hideTextEditorPopup();
        clearSelection();
        logStatus('Draw mode is active.');
    } else if (tool === 'text') {
        clearSelection();
        hideTextEditorPopup();
        logStatus('Text mode is active. Click the canvas to open the text editor.');
    } else {
        hideTextEditorPopup();
        logStatus('Selection mode is active. Drag to capture an area.');
    }
}

function clearSelectionOverlay() {
    liveCtx.clearRect(0, 0, liveCanvas.width / dpr, liveCanvas.height / dpr);
}

function clearSelection() {
    selectionRect = null;
    selectionStart = null;
    clearSelectionOverlay();
    updateActionButtons();
}

function drawSelectionOverlay() {
    clearSelectionOverlay();
    if (!selectionRect) return;

    const styles = getComputedStyle(document.body);
    liveCtx.save();
    liveCtx.setLineDash([8, 6]);
    liveCtx.lineWidth = 1.5;
    liveCtx.strokeStyle = styles.getPropertyValue('--selection').trim() || '#ffffff';
    liveCtx.fillStyle = styles.getPropertyValue('--selection-fill').trim() || 'rgba(255, 255, 255, 0.12)';
    liveCtx.strokeRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
    liveCtx.fillRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
    liveCtx.restore();
}

function renderScene() {
    const width = mainCanvas.width / dpr;
    const height = mainCanvas.height / dpr;

    mainCtx.clearRect(0, 0, width, height);
    mainCtx.fillStyle = currentBackground === 'white' ? '#ffffff' : '#020617';
    mainCtx.fillRect(0, 0, width, height);

    shapes.forEach(shape => drawShape(mainCtx, shape));
    drawSelectionOverlay();
}

function drawShape(ctx, shape) {
    ctx.save();
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.lineWidth;
    ctx.shadowColor = shape.color;

    if (shape.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(shape.start.x, shape.start.y);
        ctx.lineTo(shape.end.x, shape.end.y);
        ctx.stroke();
    } else if (shape.type === 'rect') {
        ctx.beginPath();
        ctx.rect(shape.x, shape.y, shape.width, shape.height);
        ctx.stroke();
    } else if (shape.type === 'circle') {
        ctx.beginPath();
        ctx.arc(shape.centerX, shape.centerY, shape.radius, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (shape.type === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(shape.centerX, shape.centerY, shape.radiusX, shape.radiusY, shape.rotation, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (shape.type === 'text') {
        drawTextShape(ctx, shape);
    } else if (shape.type === 'curve') {
        drawSmoothedCurve(ctx, shape.points);
    }

    ctx.restore();
}

function drawTextShape(ctx, shape) {
    const cacheKey = getTextShapeCacheKey(shape);
    const renderData = textRenderCache.get(cacheKey);

    if (!renderData) {
        void prepareTextRenderData(shape).then(() => renderScene());
        ctx.fillStyle = shape.color;
        ctx.font = `${shape.fontSize}px 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
        ctx.textBaseline = 'top';
        shape.text.split(/\r?\n/).forEach((line, index) => {
            ctx.fillText(line, shape.x, shape.y + index * shape.fontSize * 1.35);
        });
        return;
    }

    let cursorY = shape.y;
    ctx.fillStyle = shape.color;
    ctx.font = `${shape.fontSize}px 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
    ctx.textBaseline = 'top';

    renderData.lines.forEach(line => {
        let cursorX = shape.x;
        const segments = line.segments || [line];
        segments.forEach(segment => {
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

function getPerpendicularDistance(p, p1, p2) {
    if (p1.x === p2.x && p1.y === p2.y) {
        const dx = p.x - p1.x;
        const dy = p.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    const num = Math.abs((p2.y - p1.y) * p.x - (p2.x - p1.x) * p.y + p2.x * p1.y - p2.y * p1.x);
    const den = Math.sqrt(Math.pow(p2.y - p1.y, 2) + Math.pow(p2.x - p1.x, 2));
    return num / den;
}

function rdp(pointsList, epsilon) {
    if (pointsList.length < 3) return pointsList;

    let maxDistance = 0;
    let index = 0;
    const end = pointsList.length - 1;

    for (let i = 1; i < end; i++) {
        const distance = getPerpendicularDistance(pointsList[i], pointsList[0], pointsList[end]);
        if (distance > maxDistance) {
            maxDistance = distance;
            index = i;
        }
    }

    if (maxDistance > epsilon) {
        const results1 = rdp(pointsList.slice(0, index + 1), epsilon);
        const results2 = rdp(pointsList.slice(index), epsilon);
        return results1.slice(0, results1.length - 1).concat(results2);
    }

    return [pointsList[0], pointsList[end]];
}

function isLine(rdpPoints) {
    return rdpPoints.length <= 3;
}

function getCornerAnalysis(points) {
    if (points.length < 4) {
        return {
            rightAngleCorners: 0,
            significantCorners: 0,
            cornerStrength: 0
        };
    }

    const analysisPoints = points.slice();
    const first = analysisPoints[0];
    const last = analysisPoints[analysisPoints.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) < 10) {
        analysisPoints.pop();
    }

    if (analysisPoints.length < 4) {
        return {
            rightAngleCorners: 0,
            significantCorners: 0,
            cornerStrength: 0
        };
    }

    let rightAngleCorners = 0;
    let significantCorners = 0;
    let cornerStrength = 0;
    const len = analysisPoints.length;

    for (let i = 0; i < len; i++) {
        const p1 = analysisPoints[(i - 1 + len) % len];
        const p2 = analysisPoints[i];
        const p3 = analysisPoints[(i + 1) % len];

        const ux = p1.x - p2.x;
        const uy = p1.y - p2.y;
        const vx = p3.x - p2.x;
        const vy = p3.y - p2.y;

        const uMag = Math.hypot(ux, uy);
        const vMag = Math.hypot(vx, vy);
        if (uMag < 6 || vMag < 6) continue;

        const dotProduct = ux * vx + uy * vy;
        const cosTheta = dotProduct / (uMag * vMag);
        const angle = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * (180 / Math.PI);
        const significance = Math.min(uMag, vMag);

        if (angle >= 55 && angle <= 125) {
            rightAngleCorners++;
            cornerStrength += significance;
        }

        if (angle >= 40 && angle <= 140 && significance >= 10) {
            significantCorners++;
        }
    }

    return {
        rightAngleCorners,
        significantCorners,
        cornerStrength
    };
}

function isRectangle(rdpPoints) {
    if (rdpPoints.length < 4 || rdpPoints.length > 9) return false;

    const first = rdpPoints[0];
    const last = rdpPoints[rdpPoints.length - 1];
    const distStartEnd = Math.hypot(last.x - first.x, last.y - first.y);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    rdpPoints.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });

    const width = maxX - minX;
    const height = maxY - minY;
    const perimeter = 2 * (width + height);
    if (width < 12 || height < 12) return false;

    if (distStartEnd > perimeter * 0.28) return false;

    const cornerAnalysis = getCornerAnalysis(rdpPoints);
    const minEdgeDistance = Math.max(6, Math.min(width, height) * 0.12);
    let edgeAlignedPoints = 0;
    rdpPoints.forEach(p => {
        const nearVerticalEdge = Math.abs(p.x - minX) <= minEdgeDistance || Math.abs(p.x - maxX) <= minEdgeDistance;
        const nearHorizontalEdge = Math.abs(p.y - minY) <= minEdgeDistance || Math.abs(p.y - maxY) <= minEdgeDistance;
        if (nearVerticalEdge || nearHorizontalEdge) {
            edgeAlignedPoints++;
        }
    });

    return cornerAnalysis.rightAngleCorners >= 3
        && cornerAnalysis.significantCorners >= 3
        && edgeAlignedPoints >= Math.max(4, rdpPoints.length - 1);
}

function isCircle(rawPoints, rdpPoints) {
    if (rdpPoints.length < 4) return false;

    const metrics = getClosedShapeMetrics(rawPoints);
    const aspectRatio = Math.max(metrics.width, metrics.height) / Math.max(1, Math.min(metrics.width, metrics.height));
    if (aspectRatio > 1.18) return false;

    const centerX = metrics.centerX;
    const centerY = metrics.centerY;

    let totalRadius = 0;
    const radii = rawPoints.map(p => {
        const dist = Math.hypot(p.x - centerX, p.y - centerY);
        totalRadius += dist;
        return dist;
    });
    const meanRadius = totalRadius / rawPoints.length;

    let varianceSum = 0;
    radii.forEach(r => {
        varianceSum += Math.pow(r - meanRadius, 2);
    });
    const stdDev = Math.sqrt(varianceSum / rawPoints.length);

    const acceptableError = 0.20 + (rdpEpsilon * 0.02);

    return (stdDev / meanRadius < acceptableError) && (metrics.gap < meanRadius * 1.8);
}

function getClosedShapeMetrics(rawPoints) {
    let sumX = 0;
    let sumY = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    rawPoints.forEach(p => {
        sumX += p.x;
        sumY += p.y;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });

    const first = rawPoints[0];
    const last = rawPoints[rawPoints.length - 1];

    return {
        centerX: sumX / rawPoints.length,
        centerY: sumY / rawPoints.length,
        width: maxX - minX,
        height: maxY - minY,
        gap: Math.hypot(last.x - first.x, last.y - first.y)
    };
}

function isEllipse(rawPoints, rdpPoints) {
    if (rdpPoints.length < 5) return false;

    const metrics = getClosedShapeMetrics(rawPoints);
    const cornerAnalysis = getCornerAnalysis(rdpPoints);
    const radiusX = metrics.width / 2;
    const radiusY = metrics.height / 2;

    if (radiusX < 8 || radiusY < 8) return false;
    if (Math.abs(radiusX - radiusY) < Math.max(radiusX, radiusY) * 0.12) return false;
    if (metrics.gap > Math.max(radiusX, radiusY) * 1.8) return false;
    if (cornerAnalysis.rightAngleCorners >= 3 || cornerAnalysis.significantCorners >= 4) return false;

    let varianceSum = 0;
    let validPoints = 0;

    rawPoints.forEach(p => {
        const nx = (p.x - metrics.centerX) / radiusX;
        const ny = (p.y - metrics.centerY) / radiusY;
        const ellipseValue = Math.sqrt(nx * nx + ny * ny);
        varianceSum += Math.pow(ellipseValue - 1, 2);
        validPoints++;
    });

    const stdDev = Math.sqrt(varianceSum / validPoints);
    return stdDev < 0.24;
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
        simplifiedPoints[i].x,
        simplifiedPoints[i].y,
        simplifiedPoints[i + 1].x,
        simplifiedPoints[i + 1].y
    );
    ctx.stroke();
}

function createShapeFromPoints(rawPoints) {
    const simplified = rdp(rawPoints, rdpEpsilon);
    const base = {
        color: currentColor,
        lineWidth: currentLineWidth
    };

    if (smartModeCheckbox.checked) {
        if (isLine(simplified)) {
            return {
                ...base,
                type: 'line',
                start: rawPoints[0],
                end: rawPoints[rawPoints.length - 1],
                message: `Straight line detected. RDP (ε = ${rdpEpsilon.toFixed(1)}px) simplified ${rawPoints.length} points to ${simplified.length}.`
            };
        }

        if (isRectangle(simplified)) {
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            rawPoints.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            });

            return {
                ...base,
                type: 'rect',
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                message: `Rectangle detected. Orthogonal correction used RDP tolerance ${rdpEpsilon.toFixed(1)}px.`
            };
        }

        if (isEllipse(rawPoints, simplified)) {
            const { centerX, centerY, width, height } = getClosedShapeMetrics(rawPoints);
            const radiusX = width / 2;
            const radiusY = height / 2;

            return {
                ...base,
                type: 'ellipse',
                centerX,
                centerY,
                radiusX,
                radiusY,
                rotation: 0,
                message: `Ellipse detected. Center normalized to (${Math.round(centerX)}, ${Math.round(centerY)}) with radii ${Math.round(radiusX)}px and ${Math.round(radiusY)}px.`
            };
        }

        if (isCircle(rawPoints, simplified)) {
            const { centerX, centerY } = getClosedShapeMetrics(rawPoints);

            let totalRadius = 0;
            rawPoints.forEach(p => {
                totalRadius += Math.hypot(p.x - centerX, p.y - centerY);
            });
            const meanRadius = totalRadius / rawPoints.length;

            return {
                ...base,
                type: 'circle',
                centerX,
                centerY,
                radius: meanRadius,
                message: `Circle detected. Center normalized to (${Math.round(centerX)}, ${Math.round(centerY)}) with radius ${Math.round(meanRadius)}px.`
            };
        }

    }

    return {
        ...base,
        type: 'curve',
        points: simplified,
        message: smartModeCheckbox.checked
            ? `Freeform curve detected. Bezier smoothing removed ${Math.round((1 - simplified.length / rawPoints.length) * 100)}% of redundant points.`
            : `Smart shape detection is off. Curve smoothing still removed ${Math.round((1 - simplified.length / rawPoints.length) * 100)}% of redundant points.`
    };
}

function normalizeRect(start, end) {
    return {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y)
    };
}

function getEventCoords(e) {
    const rect = liveCanvas.getBoundingClientRect();
    let clientX;
    let clientY;

    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

function showTextEditorPopup(coords) {
    pendingTextPlacement = coords;
    const popupWidth = 320;
    const popupHeight = 220;
    const maxLeft = Math.max(12, liveCanvas.clientWidth - popupWidth - 12);
    const maxTop = Math.max(12, liveCanvas.clientHeight - popupHeight - 12);
    textEditorPopup.style.left = `${Math.min(coords.x, maxLeft)}px`;
    textEditorPopup.style.top = `${Math.min(coords.y, maxTop)}px`;
    textEditorPopup.classList.remove('hidden');
    updateTextPreview();
    textInput.focus();
    textInput.select();
}

function hideTextEditorPopup() {
    pendingTextPlacement = null;
    editingTextShapeIndex = null;
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
        if (window.MathJax && window.MathJax.tex2svgPromise) {
            const node = await window.MathJax.tex2svgPromise(unwrapBlockFormula(content), { display: true });
            textPreview.innerHTML = '';
            textPreview.appendChild(node);
            return;
        }
    }

    const fragments = content.split(/\r?\n/);
    const previewNodes = [];

    for (const line of fragments) {
        const div = document.createElement('div');
        div.style.minHeight = `${fontSize * 1.3}px`;
        const segments = parseLineSegments(line);
        let hasMath = false;

        for (const segment of segments) {
            if (segment.type === 'formula') {
                await waitForMathJax();
                if (window.MathJax && window.MathJax.tex2svgPromise) {
                    const node = await window.MathJax.tex2svgPromise(segment.content, { display: false });
                    div.appendChild(node);
                    hasMath = true;
                    continue;
                }
            }

            div.appendChild(document.createTextNode(segment.content));
        }

        if (!line && !hasMath) {
            div.innerHTML = '&nbsp;';
        }
        previewNodes.push(div);
    }

    textPreview.innerHTML = '';
    previewNodes.forEach(node => textPreview.appendChild(node));
}

function createTextShape(coords) {
    const content = textInput.value.trim();
    if (!content) {
        logStatus('Type some text first. Use $...$ for math.');
        return null;
    }

    const fontSize = Math.max(12, Math.min(96, parseInt(textSizeInput.value, 10) || 22));

    return {
        type: 'text',
        x: coords.x,
        y: coords.y,
        color: currentColor,
        fontSize,
        text: content,
        message: 'Text inserted on the canvas.'
    };
}

function commitTextPlacement() {
    if (!pendingTextPlacement) return;

    const textShape = createTextShape(pendingTextPlacement);
    if (!textShape) {
        return;
    }

    pushUndoState();
    if (editingTextShapeIndex !== null) {
        shapes[editingTextShapeIndex] = textShape;
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
        const renderData = textRenderCache.get(getTextShapeCacheKey(shape));
        if (!renderData) continue;
        const withinX = coords.x >= shape.x && coords.x <= shape.x + renderData.width;
        const withinY = coords.y >= shape.y && coords.y <= shape.y + renderData.height;
        if (withinX && withinY) {
            return { shape, index: i };
        }
    }

    return null;
}

function openTextEditorForShape(shapeInfo) {
    editingTextShapeIndex = shapeInfo.index;
    textInput.value = shapeInfo.shape.text;
    textSizeInput.value = shapeInfo.shape.fontSize;
    showTextEditorPopup({ x: shapeInfo.shape.x, y: shapeInfo.shape.y });
    logStatus('Editing existing text. Update content or size, then insert.');
}

function startPointer(e) {
    const coords = getEventCoords(e);

    if (currentTool === 'select') {
        isPointerActive = true;
        selectionStart = coords;
        selectionRect = { x: coords.x, y: coords.y, width: 0, height: 0 };
        drawSelectionOverlay();
        return;
    }

    if (currentTool === 'text') {
        clearSelection();
        const textShapeInfo = getTextShapeAtPoint(coords);
        if (textShapeInfo) {
            if (e.detail >= 2) {
                openTextEditorForShape(textShapeInfo);
            }
            return;
        }

        editingTextShapeIndex = null;
        textInput.value = '';
        textSizeInput.value = '22';
        showTextEditorPopup(coords);
        logStatus('Text editor opened. Set the size and content, then insert.');
        return;
    }

    isPointerActive = true;

    pointerPoints = [coords];
    clearSelection();
    liveCtx.save();
    liveCtx.strokeStyle = currentColor;
    liveCtx.lineWidth = currentLineWidth;
    liveCtx.shadowColor = currentColor;
    liveCtx.beginPath();
    liveCtx.moveTo(coords.x, coords.y);
    liveCtx.restore();
}

function movePointer(e) {
    if (!isPointerActive) return;
    e.preventDefault();

    const coords = getEventCoords(e);

    if (currentTool === 'select') {
        selectionRect = normalizeRect(selectionStart, coords);
        drawSelectionOverlay();
        updateActionButtons();
        return;
    }

    pointerPoints.push(coords);
    if (pointerPoints.length > 2) {
        const i = pointerPoints.length - 2;
        const xc = (pointerPoints[i].x + pointerPoints[i + 1].x) / 2;
        const yc = (pointerPoints[i].y + pointerPoints[i + 1].y) / 2;

        liveCtx.save();
        liveCtx.strokeStyle = currentColor;
        liveCtx.lineWidth = currentLineWidth;
        liveCtx.shadowColor = currentColor;
        liveCtx.quadraticCurveTo(pointerPoints[i].x, pointerPoints[i].y, xc, yc);
        liveCtx.stroke();
        liveCtx.restore();
    }
}

function stopPointer() {
    if (!isPointerActive) return;
    isPointerActive = false;

    if (currentTool === 'select') {
        if (selectionRect && (selectionRect.width < 4 || selectionRect.height < 4)) {
            clearSelection();
        } else {
            drawSelectionOverlay();
            logStatus('Selection is ready to copy.');
        }
        updateActionButtons();
        return;
    }

    clearSelectionOverlay();
    if (pointerPoints.length < 2) {
        pointerPoints = [];
        return;
    }

    pushUndoState();
    const shape = createShapeFromPoints(pointerPoints);
    shapes.push(shape);
    pointerPoints = [];
    renderScene();
    logStatus(shape.message);
}

async function copySelectionToClipboard() {
    if (!selectionRect) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = Math.max(1, Math.round(selectionRect.width * dpr));
    offscreen.height = Math.max(1, Math.round(selectionRect.height * dpr));
    const offscreenCtx = offscreen.getContext('2d');

    offscreenCtx.drawImage(
        mainCanvas,
        Math.round(selectionRect.x * dpr),
        Math.round(selectionRect.y * dpr),
        Math.round(selectionRect.width * dpr),
        Math.round(selectionRect.height * dpr),
        0,
        0,
        offscreen.width,
        offscreen.height
    );

    if (!navigator.clipboard || !window.ClipboardItem) {
        logStatus('This browser does not support copying images to the clipboard.');
        return;
    }

    try {
        const blob = await new Promise(resolve => offscreen.toBlob(resolve, 'image/png'));
        if (!blob) {
            throw new Error('toBlob failed');
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        logStatus('Selection copied to the clipboard as a PNG image.');
    } catch (error) {
        logStatus('Clipboard write failed. Use localhost or HTTPS to enable image copy.');
    }
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
    const modifier = e.metaKey || e.ctrlKey;
    if (!modifier) return;

    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
    }

    if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
        return;
    }

    if (key === 'c' && selectionRect) {
        e.preventDefault();
        copySelectionToClipboard();
    }
}

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
copySelectionBtn.addEventListener('click', copySelectionToClipboard);
drawToolBtn.addEventListener('click', () => setTool('draw'));
textToolBtn.addEventListener('click', () => setTool('text'));
selectToolBtn.addEventListener('click', () => setTool('select'));
bgWhiteBtn.addEventListener('click', () => setBackground('white'));
bgBlackBtn.addEventListener('click', () => setBackground('black'));
insertTextBtn.addEventListener('click', commitTextPlacement);
cancelTextBtn.addEventListener('click', () => {
    hideTextEditorPopup();
    logStatus('Text insertion cancelled.');
});
textInput.addEventListener('input', () => {
    void updateTextPreview();
});
textSizeInput.addEventListener('input', () => {
    void updateTextPreview();
});
window.addEventListener('resize', resizeCanvases);
window.addEventListener('keydown', handleKeyboardShortcuts);

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

liveCanvas.addEventListener('touchstart', e => {
    startPointer(e);
    e.preventDefault();
}, { passive: false });

liveCanvas.addEventListener('touchmove', e => {
    movePointer(e);
    e.preventDefault();
}, { passive: false });

window.addEventListener('touchend', stopPointer);

applyBackgroundTheme();
initColorPalette();
setTool('draw');
updateActionButtons();
resizeCanvases();