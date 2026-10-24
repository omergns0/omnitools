/* OmniTools — all processing happens in this tab. Nothing here talks to the network. */
(function () {
    'use strict';

    const { t } = window.I18n;
    const { PDFDocument, PDFName, PDFRef } = window.PDFLib;
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

    const $ = (sel, root = document) => root.querySelector(sel);

    /* ---------- Small helpers ---------- */

    // Builds DOM nodes. Text is always set with textContent, so file names can never inject HTML.
    function h(tag, props, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props || {})) {
            if (v == null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? '' : v);
        }
        for (const c of children) if (c != null) node.append(c);
        return node;
    }

    function icon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#i-' + name);
        svg.append(use);
        return svg;
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    }

    function baseName(name) {
        const i = name.lastIndexOf('.');
        return i > 0 ? name.slice(0, i) : name;
    }

    function setMsg(el, text, kind) {
        el.textContent = text || '';
        el.className = 'msg' + (kind ? ' ' + kind : '');
    }

    function setBusy(btn, busy) {
        if (busy) {
            btn.dataset.label = btn.textContent;
            btn.disabled = true;
            btn.replaceChildren(h('span', { class: 'spin' }), ' ' + t('working'));
        } else {
            btn.disabled = false;
            if (btn.dataset.i18n) btn.textContent = t(btn.dataset.i18n);
            else if (btn.dataset.label) btn.textContent = btn.dataset.label;
        }
    }

    function download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: filename });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    const isImage = (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(f.name);

    function errText(e) {
        return (e && e.message) || String(e);
    }

    async function loadPdfLib(file) {
        const bytes = await file.arrayBuffer();
        try {
            return await PDFDocument.load(bytes, { updateMetadata: false });
        } catch (e) {
            if (/encrypt/i.test(errText(e))) throw new Error(t('encrypted', { name: file.name }));
            throw new Error(t('readError', { name: file.name, err: errText(e) }));
        }
    }

    async function openPdfJs(file) {
        const data = new Uint8Array(await file.arrayBuffer());
        try {
            // isEvalSupported:false keeps pdf.js from compiling code out of PDF fonts.
            return await pdfjsLib.getDocument({ data, isEvalSupported: false, disableAutoFetch: true }).promise;
        } catch (e) {
            if (e && e.name === 'PasswordException') throw new Error(t('encrypted', { name: file.name }));
            throw new Error(t('readError', { name: file.name, err: errText(e) }));
        }
    }

    // Decodes an image and applies its EXIF orientation. Re-encoding the pixels later drops all EXIF.
    async function decodeImage(file) {
        if ('createImageBitmap' in window && !/svg/i.test(file.type)) {
            try {
                return await createImageBitmap(file, { imageOrientation: 'from-image' });
            } catch (_) { /* fall back to <img> below */ }
        }
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            return img;
        } catch (_) {
            throw new Error(t('imageDecodeError', { name: file.name }));
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function canvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality);
        });
    }

    function drawToCanvas(img, maxWidth, background) {
        let w = img.width, hgt = img.height;
        if (maxWidth && w > maxWidth) {
            hgt = Math.round(hgt * (maxWidth / w));
            w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = hgt;
        const ctx = canvas.getContext('2d');
        if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, w, hgt);
        }
        ctx.drawImage(img, 0, 0, w, hgt);
        if (img.close) img.close();
        return canvas;
    }

    /* ---------- Shared UI pieces ---------- */

    // Segmented controls: returns a getter for the current value.
    const segValues = {};
    document.querySelectorAll('.seg').forEach((seg) => {
        const name = seg.dataset.name;
        const active = seg.querySelector('.active') || seg.querySelector('button');
        segValues[name] = active.dataset.value;
        seg.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
            segValues[name] = btn.dataset.value;
            seg.dispatchEvent(new CustomEvent('segchange', { detail: btn.dataset.value }));
        });
    });
    const seg = (name) => segValues[name];

    // Drop zone: click, keyboard and drag & drop all feed the same callback.
    function setupDrop(inputId, onFiles) {
        const input = document.getElementById(inputId);
        const zone = document.querySelector(`.drop[data-input="${inputId}"]`);
        input.addEventListener('change', () => {
            if (input.files.length) onFiles(Array.from(input.files));
            input.value = ''; // allow selecting the same file again
        });
        zone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
        });
        ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
            e.preventDefault();
            zone.classList.add('over');
        }));
        ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('over')));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files || []);
            if (!input.multiple) files.splice(1);
            if (files.length) onFiles(files);
        });
    }

    // Stops the browser from opening a file that is dropped outside a drop zone.
    ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => {
        if (!e.target.closest || !e.target.closest('.drop')) e.preventDefault();
    }));

    /**
     * Reorderable file list. `items` is an array of {file, thumb?}; mutating callbacks re-render.
     */
    function renderFileList(container, items, { reorder = true, onChange, meta } = {}) {
        container.replaceChildren(...items.map((item, i) => {
            const move = (delta) => {
                const j = i + delta;
                [items[i], items[j]] = [items[j], items[i]];
                onChange();
            };
            const remove = () => {
                if (item.thumb) URL.revokeObjectURL(item.thumb);
                items.splice(i, 1);
                onChange();
            };
            const visual = item.thumb
                ? h('img', { class: 'row-thumb', src: item.thumb, alt: '' })
                : h('span', { class: 'row-icon' }, icon('file'));
            return h('div', { class: 'row' },
                reorder ? h('span', { class: 'row-idx', text: String(i + 1) }) : null,
                visual,
                h('span', { class: 'row-name', text: item.file.name, title: item.file.name }),
                h('span', { class: 'row-meta', text: meta ? meta(item) : formatSize(item.file.size) }),
                h('span', { class: 'row-btns' },
                    reorder ? h('button', { type: 'button', class: 'icon-btn', title: t('moveUp'), 'aria-label': t('moveUp'), disabled: i === 0, onclick: () => move(-1) }, icon('up')) : null,
                    reorder ? h('button', { type: 'button', class: 'icon-btn', title: t('moveDown'), 'aria-label': t('moveDown'), disabled: i === items.length - 1, onclick: () => move(1) }, icon('down')) : null,
                    h('button', { type: 'button', class: 'icon-btn', title: t('remove'), 'aria-label': t('remove'), onclick: remove }, icon('x')),
                ),
            );
        }));
    }

    function resultCard({ src, title, meta, blob, filename }) {
        return h('div', { class: 'card' },
            h('img', { src, alt: title, loading: 'lazy' }),
            h('span', { class: 'card-title', text: title, title: filename }),
            meta || null,
            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => download(blob, filename) }, icon('download'), ' ' + t('download')),
        );
    }

    // Keeps object URLs for a result grid so they can be released on the next run.
    function urlBag() {
        let urls = [];
        return {
            add(blob) { const u = URL.createObjectURL(blob); urls.push(u); return u; },
            clear() { urls.forEach(URL.revokeObjectURL); urls = []; },
        };
    }

    // Filters dropped files by type and reports the ones that were skipped.
    function accept(files, test, msgEl, key) {
        const ok = files.filter(test);
        const bad = files.filter((f) => !test(f));
        setMsg(msgEl, bad.map((f) => t(key, { name: f.name })).join(' '), bad.length ? 'err' : '');
        return ok;
    }

    /* ---------- 1. Image converter ---------- */
    {
        const items = [];
        const list = $('#convList'), runBtn = $('#convRun'), zipBtn = $('#convZip');
        const msg = $('#convMsg'), results = $('#convResults');
        const quality = $('#convQuality'), qualityOut = $('#convQualityOut'), qualityWrap = $('#convQualityWrap');
        const urls = urlBag();
        let outputs = [];

        const refresh = () => {
            renderFileList(list, items, { reorder: false, onChange: refresh });
            runBtn.disabled = !items.length;
        };
        const syncQuality = () => { qualityWrap.hidden = seg('convFormat') === 'image/png'; };
        $('.seg[data-name="convFormat"]').addEventListener('segchange', syncQuality);
        syncQuality();
        quality.addEventListener('input', () => { qualityOut.textContent = quality.value; });

        setupDrop('convInput', (files) => {
            for (const file of accept(files, isImage, msg, 'notImage')) items.push({ file, thumb: URL.createObjectURL(file) });
            refresh();
        });

        runBtn.addEventListener('click', async () => {
            const type = seg('convFormat');
            const q = Number(quality.value) / 100;
            const maxW = parseInt($('#convMaxWidth').value, 10) || 0;
            const errors = [];
            let webpFallback = false;

            setBusy(runBtn, true);
            urls.clear();
            outputs = [];
            results.replaceChildren();
            zipBtn.hidden = true;

            for (let i = 0; i < items.length; i++) {
                const { file } = items[i];
                setMsg(msg, t('progress', { done: i + 1, total: items.length }));
                try {
                    const img = await decodeImage(file);
                    const canvas = drawToCanvas(img, maxW, type === 'image/jpeg' ? '#ffffff' : null);
                    const blob = await canvasToBlob(canvas, type, q);
                    if (blob.type !== type) webpFallback = true;
                    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type] || 'png';
                    const filename = `${baseName(file.name)}.${ext}`;
                    outputs.push({ name: filename, data: blob });

                    const diff = Math.round((1 - blob.size / file.size) * 100);
                    const meta = h('span', { class: 'card-meta' },
                        `${formatSize(file.size)} → ${formatSize(blob.size)} `,
                        diff > 0 ? h('span', { class: 'saved', text: `(-${diff}%)` }) : null,
                        ` · ${canvas.width}×${canvas.height}`,
                    );
                    results.append(resultCard({ src: urls.add(blob), title: filename, meta, blob, filename }));
                } catch (e) {
                    errors.push(errText(e));
                }
            }

            setBusy(runBtn, false);
            zipBtn.hidden = outputs.length < 2;
            const notes = [t('doneCount', { n: outputs.length })];
            if (webpFallback) notes.push(t('webpUnsupported'));
            setMsg(msg, notes.concat(errors).join(' '), errors.length ? 'err' : 'ok');
        });

        zipBtn.addEventListener('click', async () => {
            download(await window.OmniZip.createZip(outputs), 'omnitools-images.zip');
        });
    }

    /* ---------- 2. Merge PDFs ---------- */
    {
        const items = [];
        const list = $('#mergeList'), runBtn = $('#mergeRun'), msg = $('#mergeMsg');
        const refresh = () => {
            renderFileList(list, items, { onChange: refresh });
            runBtn.disabled = items.length < 2;
        };

        setupDrop('mergeInput', (files) => {
            for (const file of accept(files, isPdf, msg, 'notPdf')) items.push({ file });
            refresh();
        });

        runBtn.addEventListener('click', async () => {
            if (items.length < 2) return setMsg(msg, t('needTwoPdfs'), 'err');
            setBusy(runBtn, true);
            try {
                const merged = await PDFDocument.create({ updateMetadata: false });
                for (let i = 0; i < items.length; i++) {
                    setMsg(msg, t('progress', { done: i + 1, total: items.length }));
                    const src = await loadPdfLib(items[i].file);
                    const pages = await merged.copyPages(src, src.getPageIndices());
                    pages.forEach((p) => merged.addPage(p));
                }
                const bytes = await merged.save();
                download(new Blob([bytes], { type: 'application/pdf' }), 'merged.pdf');
                setMsg(msg, t('doneDownloaded'), 'ok');
            } catch (e) {
                setMsg(msg, errText(e), 'err');
            } finally {
                setBusy(runBtn, false);
            }
        });
    }

    /* ---------- 3. Split / extract pages ---------- */

    // "1-3, 5, 8-" -> [0,1,2,4,7,8,...] (zero-based, in the order written, duplicates kept once).
    function parseRange(text, total) {
        const trimmed = text.trim();
        if (!trimmed) return Array.from({ length: total }, (_, i) => i);
        const out = [];
        const seen = new Set();
        for (const raw of trimmed.split(/[,;]+/)) {
            const part = raw.trim();
            if (!part) continue;
            const m = part.match(/^(\d*)\s*[-–]\s*(\d*)$/) || part.match(/^(\d+)$/);
            if (!m || (m[1] === '' && m[2] === '')) throw new Error(t('rangeInvalid', { part }));
            const from = m[1] === '' ? 1 : parseInt(m[1], 10);
            const to = m.length === 2 ? from : (m[2] === '' ? total : parseInt(m[2], 10));
            for (const n of [from, to]) {
                if (n < 1 || n > total) throw new Error(t('rangeOutOf', { n, total }));
            }
            const step = from <= to ? 1 : -1;
            for (let n = from; step > 0 ? n <= to : n >= to; n += step) {
                if (!seen.has(n)) { seen.add(n); out.push(n - 1); }
            }
        }
        return out;
    }

    {
        let current = null; // {file, doc, pages}
        const list = $('#splitList'), runBtn = $('#splitRun'), msg = $('#splitMsg');
        const options = $('#splitOptions'), range = $('#splitRange');

        const refresh = () => {
            const items = current ? [current] : [];
            renderFileList(list, items, {
                reorder: false,
                meta: (it) => `${t('pagesCount', { n: it.pages })} · ${formatSize(it.file.size)}`,
                onChange: () => { current = null; refresh(); },
            });
            options.hidden = !current;
            runBtn.disabled = !current;
            if (current) range.placeholder = `1-${current.pages}`;
        };

        setupDrop('splitInput', async (files) => {
            const [file] = accept(files, isPdf, msg, 'notPdf');
            if (!file) return;
            try {
                const doc = await loadPdfLib(file);
                current = { file, doc, pages: doc.getPageCount() };
                range.value = '';
                setMsg(msg, t('rangeHint', { total: current.pages }));
            } catch (e) {
                current = null;
                setMsg(msg, errText(e), 'err');
            }
            refresh();
        });

        runBtn.addEventListener('click', async () => {
            if (!current) return;
            let indices;
            try {
                indices = parseRange(range.value, current.pages);
            } catch (e) {
                return setMsg(msg, errText(e), 'err');
            }
            setBusy(runBtn, true);
            try {
                const base = baseName(current.file.name);
                if (seg('splitMode') === 'single') {
                    const out = await PDFDocument.create({ updateMetadata: false });
                    (await out.copyPages(current.doc, indices)).forEach((p) => out.addPage(p));
                    download(new Blob([await out.save()], { type: 'application/pdf' }), `${base}-pages.pdf`);
                } else {
                    const entries = [];
                    for (let i = 0; i < indices.length; i++) {
                        setMsg(msg, t('progress', { done: i + 1, total: indices.length }));
                        const out = await PDFDocument.create({ updateMetadata: false });
                        const [p] = await out.copyPages(current.doc, [indices[i]]);
                        out.addPage(p);
                        entries.push({ name: `${base}-page-${indices[i] + 1}.pdf`, data: await out.save() });
                    }
                    download(await window.OmniZip.createZip(entries), `${base}-pages.zip`);
                }
                setMsg(msg, t('doneDownloaded'), 'ok');
            } catch (e) {
                setMsg(msg, errText(e), 'err');
            } finally {
                setBusy(runBtn, false);
            }
        });
    }

    /* ---------- 4. Images to PDF ---------- */
    {
        const items = [];
        const list = $('#i2pList'), runBtn = $('#i2pRun'), msg = $('#i2pMsg');
        const A4 = [595.28, 841.89];

        const refresh = () => {
            renderFileList(list, items, { onChange: refresh });
            runBtn.disabled = !items.length;
        };

        setupDrop('i2pInput', (files) => {
            for (const file of accept(files, isImage, msg, 'notImage')) items.push({ file, thumb: URL.createObjectURL(file) });
            refresh();
        });

        runBtn.addEventListener('click', async () => {
            const margin = Number(seg('i2pMargin'));
            const fit = seg('i2pSize') === 'fit';
            setBusy(runBtn, true);
            try {
                const doc = await PDFDocument.create({ updateMetadata: false });
                for (let i = 0; i < items.length; i++) {
                    setMsg(msg, t('progress', { done: i + 1, total: items.length }));
                    const { file } = items[i];
                    const img = await decodeImage(file);
                    // PNG keeps transparency and sharp text; everything else becomes a compact JPEG.
                    const asPng = /png|gif|svg/i.test(file.type);
                    const canvas = drawToCanvas(img, 0, asPng ? null : '#ffffff');
                    const blob = await canvasToBlob(canvas, asPng ? 'image/png' : 'image/jpeg', 0.92);
                    const bytes = new Uint8Array(await blob.arrayBuffer());
                    const embedded = asPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

                    // 96 px per inch on screen -> 72 pt per inch in PDF.
                    const imgW = canvas.width * 0.75, imgH = canvas.height * 0.75;
                    let pageW, pageH;
                    if (fit) {
                        pageW = imgW + margin * 2;
                        pageH = imgH + margin * 2;
                    } else {
                        [pageW, pageH] = imgW > imgH ? [A4[1], A4[0]] : A4;
                    }
                    const scale = Math.min((pageW - margin * 2) / imgW, (pageH - margin * 2) / imgH, fit ? 1 : Infinity);
                    const drawW = imgW * scale, drawH = imgH * scale;
                    const page = doc.addPage([pageW, pageH]);
                    page.drawImage(embedded, { x: (pageW - drawW) / 2, y: (pageH - drawH) / 2, width: drawW, height: drawH });
                }
                download(new Blob([await doc.save()], { type: 'application/pdf' }), 'images.pdf');
                setMsg(msg, t('doneDownloaded'), 'ok');
            } catch (e) {
                setMsg(msg, errText(e), 'err');
            } finally {
                setBusy(runBtn, false);
            }
        });
    }

    /* ---------- 5. PDF to images ---------- */
    {
        const msg = $('#p2iMsg'), results = $('#p2iResults'), zipBtn = $('#p2iZip');
        const urls = urlBag();
        let outputs = [];
        let runId = 0;

        setupDrop('p2iInput', async (files) => {
            const [file] = accept(files, isPdf, msg, 'notPdf');
            if (!file) return;
            const id = ++runId;
            const scale = Number(seg('p2iScale'));
            const type = seg('p2iFormat');
            const ext = type === 'image/png' ? 'png' : 'jpg';
            const base = baseName(file.name);

            urls.clear();
            outputs = [];
            results.replaceChildren();
            zipBtn.hidden = true;

            let pdf;
            try {
                pdf = await openPdfJs(file);
                for (let n = 1; n <= pdf.numPages; n++) {
                    if (id !== runId) return; // a newer file was dropped
                    setMsg(msg, t('progress', { done: n, total: pdf.numPages }));
                    const page = await pdf.getPage(n);
                    const viewport = page.getViewport({ scale });
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.floor(viewport.width);
                    canvas.height = Math.floor(viewport.height);
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    await page.render({ canvasContext: ctx, viewport }).promise;
                    page.cleanup();
                    const blob = await canvasToBlob(canvas, type, 0.92);
                    canvas.width = canvas.height = 0; // free GPU memory early
                    const filename = `${base}-page-${n}.${ext}`;
                    outputs.push({ name: filename, data: blob });
                    results.append(resultCard({
                        src: urls.add(blob),
                        title: t('page', { n }),
                        meta: h('span', { class: 'card-meta', text: `${Math.floor(viewport.width)}×${Math.floor(viewport.height)} · ${formatSize(blob.size)}` }),
                        blob,
                        filename,
                    }));
                }
                zipBtn.hidden = outputs.length < 2;
                setMsg(msg, t('doneCount', { n: outputs.length }), 'ok');
            } catch (e) {
                setMsg(msg, errText(e), 'err');
            } finally {
                if (pdf) pdf.destroy();
            }
        });

        zipBtn.addEventListener('click', async () => {
            download(await window.OmniZip.createZip(outputs), 'omnitools-pages.zip');
        });
    }

    /* ---------- 6. Metadata cleaner ---------- */

    function readMetadata(doc) {
        // A malformed field must not hide the others, so each getter is isolated.
        const safe = (fn) => { try { return fn(); } catch (_) { return t('metaPresent'); } };
        const fmtDate = (d) => (d && !isNaN(d) ? d.toLocaleString(window.I18n.lang) : '');
        const info = [
            ['metaTitle', safe(() => doc.getTitle())],
            ['metaAuthor', safe(() => doc.getAuthor())],
            ['metaSubject', safe(() => doc.getSubject())],
            ['metaKeywords', safe(() => doc.getKeywords())],
            ['metaCreator', safe(() => doc.getCreator())],
            ['metaProducer', safe(() => doc.getProducer())],
            ['metaCreated', safe(() => fmtDate(doc.getCreationDate()))],
            ['metaModified', safe(() => fmtDate(doc.getModificationDate()))],
            ['metaXmp', doc.catalog.get(PDFName.of('Metadata')) ? t('metaPresent') : ''],
            ['metaId', doc.context.trailerInfo.ID ? t('metaPresent') : ''],
        ];
        return info.map(([key, value]) => ({ key, value: value || '' }));
    }

    function stripMetadata(doc) {
        // XMP stream referenced from the catalog
        const xmpRef = doc.catalog.get(PDFName.of('Metadata'));
        doc.catalog.delete(PDFName.of('Metadata'));
        if (xmpRef instanceof PDFRef) doc.context.delete(xmpRef);
        // Classic /Info dictionary (title, author, producer, dates ...)
        const infoRef = doc.context.trailerInfo.Info;
        if (infoRef) {
            doc.context.delete(infoRef);
            doc.context.trailerInfo.Info = undefined;
        }
        // The trailer /ID is a fingerprint that can link copies of a file together.
        doc.context.trailerInfo.ID = undefined;
        // Per-page metadata and application private data
        for (const page of doc.getPages()) {
            page.node.delete(PDFName.of('Metadata'));
            page.node.delete(PDFName.of('PieceInfo'));
        }
        doc.catalog.delete(PDFName.of('PieceInfo'));
    }

    {
        let items = []; // {file, doc, meta}
        const report = $('#cleanReport'), runBtn = $('#cleanRun'), msg = $('#cleanMsg');

        const refresh = () => {
            report.replaceChildren(...items.map((it, i) => {
                const found = it.meta.filter((m) => m.value).length;
                return h('div', { class: 'report' },
                    h('h4', {},
                        `${it.file.name} — `,
                        h('span', { class: found ? 'found' : 'saved', text: found ? t('metaFoundCount', { n: found }) : t('metaClean') }),
                    ),
                    h('table', {}, h('tbody', {}, ...it.meta.map((m) => h('tr', {},
                        h('td', { text: t(m.key) }),
                        h('td', { class: m.value ? 'found' : 'empty', text: m.value || t('metaEmpty') }),
                    )))),
                );
            }));
            runBtn.disabled = !items.length;
        };

        setupDrop('cleanInput', async (files) => {
            const errors = [];
            for (const file of accept(files, isPdf, msg, 'notPdf')) {
                try {
                    const doc = await loadPdfLib(file);
                    items.push({ file, doc, meta: readMetadata(doc) });
                } catch (e) {
                    errors.push(errText(e));
                }
            }
            if (errors.length) setMsg(msg, errors.join(' '), 'err');
            refresh();
        });

        runBtn.addEventListener('click', async () => {
            setBusy(runBtn, true);
            try {
                const outputs = [];
                for (const it of items) {
                    // Re-load so the report above keeps showing the original values.
                    const doc = await loadPdfLib(it.file);
                    stripMetadata(doc);
                    const bytes = await doc.save({ addDefaultPage: false });
                    outputs.push({ name: `${baseName(it.file.name)}-clean.pdf`, data: bytes });
                }
                if (outputs.length === 1) download(new Blob([outputs[0].data], { type: 'application/pdf' }), outputs[0].name);
                else download(await window.OmniZip.createZip(outputs), 'omnitools-clean.zip');
                setMsg(msg, t('cleaned', { n: outputs.length }), 'ok');
            } catch (e) {
                setMsg(msg, errText(e), 'err');
            } finally {
                setBusy(runBtn, false);
            }
        });
    }

    /* ---------- Tabs (deep-linkable via #hash) ---------- */
    const tabs = Array.from(document.querySelectorAll('.tab'));
    function showTab(name) {
        if (!tabs.some((b) => b.dataset.tab === name)) name = 'convert';
        tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
        document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'panel-' + name; });
    }
    tabs.forEach((b) => b.addEventListener('click', () => {
        history.replaceState(null, '', '#' + b.dataset.tab);
        showTab(b.dataset.tab);
    }));
    window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
    showTab(location.hash.slice(1));

    /* ---------- Privacy & offline indicators ---------- */
    const netPill = $('#netStatus'), netText = $('#netStatusText');
    function updateNetwork() {
        // Counts every resource this page has loaded from somewhere other than its own folder.
        const external = performance.getEntriesByType('resource').filter((e) => {
            try { return new URL(e.name, location.href).origin !== location.origin; } catch (_) { return false; }
        }).length;
        netText.textContent = external ? t('netSome', { n: external }) : t('netZero');
        netPill.className = 'pill ' + (external ? 'pill-warn' : 'pill-ok');
        netPill.title = t('netTitle');
    }
    if ('PerformanceObserver' in window) {
        try { new PerformanceObserver(updateNetwork).observe({ type: 'resource', buffered: true }); } catch (_) { /* old browser */ }
    }

    const offText = $('#offlineStatusText'), offPill = $('#offlineStatus');
    let offlineState = 'offlineNone';
    function renderOffline() {
        offText.textContent = t(offlineState);
        offPill.className = 'pill ' + (offlineState === 'offlineReady' || offlineState === 'offlineLocal' ? 'pill-ok' : 'pill-muted');
    }
    function setOffline(state) { offlineState = state; renderOffline(); }

    if (location.protocol === 'file:') {
        // Opened straight from disk: already offline by definition, and browsers refuse
        // manifests and service workers over file://, so neither is set up.
        setOffline('offlineLocal');
    } else {
        document.head.append(h('link', { rel: 'manifest', href: 'manifest.webmanifest' }));
        if ('serviceWorker' in navigator) {
            setOffline(navigator.serviceWorker.controller ? 'offlineReady' : 'offlinePreparing');
            navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready)
                .then(() => setOffline('offlineReady'))
                .catch(() => setOffline('offlineNone'));
        } else {
            setOffline('offlineNone');
        }
    }

    /* ---------- Language ---------- */
    const langBtn = $('#langToggle');
    function renderLang() {
        window.I18n.apply();
        langBtn.textContent = window.I18n.lang === 'tr' ? 'EN' : 'TR';
        updateNetwork();
        renderOffline();
    }
    langBtn.addEventListener('click', () => {
        window.I18n.setLang(window.I18n.lang === 'tr' ? 'en' : 'tr');
        renderLang();
    });
    renderLang();

    // Exposed for debugging and automated browser tests; not used by the UI.
    window.OmniTools = { parseRange, stripMetadata, readMetadata };
})();
