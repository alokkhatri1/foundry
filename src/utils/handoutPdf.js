// Build the takeaway as a designed PDF.
//
// Page rhythm:
//   Page 1     — cover only, vertically centered (title-page treatment)
//   Pages 2..N — reflection cards, two per page, with the closer footer
//                stamped at the bottom of each
//
// Implementation: capture the whole .gr-takeaway DOM once, then carve
// the resulting canvas into three regions — cover, cards, closer —
// using the elements' measured top/bottom positions. The cards region
// is sub-sliced per PDF page; the cover lands once on page 1, the
// closer lands as a footer on every content page.

function safeName(s) {
  return (s || 'Participant').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

const A4_PORTRAIT_W_PT = 595;
const A4_PORTRAIT_H_PT = 842;

// Carve a sub-canvas from a source canvas at [fromY, toY) in canvas px.
// Backfills cream so any sub-pixel artifact reads as page bg, not white.
function subCanvas(src, fromY, toY) {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = Math.max(1, Math.floor(toY - fromY));
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#FBF4EE';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, -fromY);
  return out;
}

export async function buildHandoutPdf({ userName, captureSelector = '.gr-takeaway' }) {
  const el = document.querySelector(captureSelector);
  if (!el) throw new Error(`Handout DOM "${captureSelector}" not found — make sure HandoutPage is mounted before calling.`);

  const coverEl = el.querySelector('.gr-takeaway-cover');
  const cardsEl = el.querySelector('.gr-takeaway-cards');
  const closerEl = el.querySelector('.gr-takeaway-closer');
  const cardEls = Array.from(el.querySelectorAll('.gr-takeaway-card'));

  // Measure CSS boundaries before capture (the captured canvas has no
  // DOM to query). All measurements are relative to the parent
  // .gr-takeaway so they line up with the canvas top.
  const elRect = el.getBoundingClientRect();
  const elTop = elRect.top;
  const cssTotalHeight = el.offsetHeight;

  const coverBottomCss = coverEl ? coverEl.getBoundingClientRect().bottom - elTop : 0;
  const cardsRect = cardsEl ? cardsEl.getBoundingClientRect() : null;
  const cardsTopCss = cardsRect ? cardsRect.top - elTop : coverBottomCss;
  const cardsBottomCss = cardsRect ? cardsRect.bottom - elTop : cardsTopCss;
  const closerTopCss = closerEl ? closerEl.getBoundingClientRect().top - elTop : cardsBottomCss;

  const cardCssBounds = cardsRect
    ? cardEls.map(c => {
        const r = c.getBoundingClientRect();
        return { top: r.top - cardsRect.top, bottom: r.bottom - cardsRect.top };
      })
    : [];

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#FBF4EE',
    useCORS: true,
    onclone: (clonedDoc) => {
      const dots = clonedDoc.querySelectorAll('.gr-plate-level-dot');
      dots.forEach(d => { d.style.boxShadow = 'none'; });
    },
  });

  const cssToCanvas = canvas.height / cssTotalHeight;
  const coverBottomPx = coverBottomCss * cssToCanvas;
  const cardsTopPx = cardsTopCss * cssToCanvas;
  const cardsBottomPx = cardsBottomCss * cssToCanvas;
  const closerTopPx = closerTopCss * cssToCanvas;

  // Pre-baked cover and closer images, stamped on every page.
  const coverCanvas = subCanvas(canvas, 0, coverBottomPx);
  const closerCanvas = subCanvas(canvas, closerTopPx, canvas.height);
  const cardsCanvas = subCanvas(canvas, cardsTopPx, cardsBottomPx);

  // Card boundaries relative to the cards canvas top, in canvas px.
  const cardBounds = cardCssBounds.map(b => ({
    top: b.top * cssToCanvas,
    bottom: b.bottom * cssToCanvas,
  }));

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = A4_PORTRAIT_W_PT;
  const pageH = A4_PORTRAIT_H_PT;
  const pxPerPt = canvas.width / pageW;

  const coverHeightPt = coverCanvas.height / pxPerPt;
  const closerHeightPt = closerCanvas.height / pxPerPt;
  // Top margin on content pages — matches the takeaway's outer
  // padding so the cards body is visually anchored, not floating.
  const contentTopPt = 56;
  // Breathing gap between the last card slice and the closer footer.
  const gapPt = 16;
  const cardsAvailHeightPt = pageH - contentTopPt - closerHeightPt - gapPt;
  const cardsAvailHeightPx = cardsAvailHeightPt * pxPerPt;
  // Card-aware break only honours a card boundary if it leaves at
  // least 25% of the cards body filled — otherwise we'd ship pages
  // that are almost empty in the middle.
  const minPageFillPx = cardsAvailHeightPx * 0.25;

  // Paint the page cream before stamping any layers. Otherwise any
  // uncovered area reveals jsPDF's default white page background.
  function paintPageBg() {
    pdf.setFillColor(251, 244, 238); // var(--cream) #FBF4EE
    pdf.rect(0, 0, pageW, pageH, 'F');
  }

  // Page 1 — cover only, vertically centered. Title-page treatment so
  // the editorial moment of "your reflections" gets to breathe before
  // the dense Q&A cards begin.
  paintPageBg();
  const coverY = Math.max(contentTopPt, (pageH - coverHeightPt) / 2);
  pdf.addImage(coverCanvas, 'PNG', 0, coverY, pageW, coverHeightPt);

  // No cards (participant didn't reflect on anything): drop the closer
  // at the bottom of the cover page and ship a one-page artifact.
  if (cardsCanvas.height <= 0 || cardsAvailHeightPx <= 0) {
    pdf.addImage(closerCanvas, 'PNG', 0, pageH - closerHeightPt, pageW, closerHeightPt);
    return { doc: pdf, filename: `${safeName(userName)}_Foundry_Takeaway.pdf` };
  }

  // Pages 2..N — cards (top-anchored) + closer (bottom-anchored). No
  // repeated cover header; each content page carries a uniform rhythm.
  let cardsPosPx = 0;
  while (cardsPosPx < cardsCanvas.height) {
    const remainingPx = cardsCanvas.height - cardsPosPx;
    let endPx = Math.min(cardsPosPx + cardsAvailHeightPx, cardsCanvas.height);

    // Avoid cutting through a card: if the page edge falls inside one,
    // back the cut up to that card's top.
    let breakAt = null;
    for (const b of cardBounds) {
      const startsInRange = b.top > cardsPosPx + 1 && b.top < endPx;
      const extendsBeyond = b.bottom > endPx;
      if (startsInRange && extendsBeyond) {
        if (breakAt === null || b.top < breakAt) breakAt = b.top;
      }
    }
    if (breakAt !== null && breakAt - cardsPosPx >= minPageFillPx) {
      endPx = breakAt;
    }
    if (remainingPx <= cardsAvailHeightPx) {
      endPx = cardsCanvas.height;
    }

    const cardsSlice = subCanvas(cardsCanvas, cardsPosPx, endPx);
    const cardsSliceHeightPt = cardsSlice.height / pxPerPt;

    pdf.addPage();
    paintPageBg();
    pdf.addImage(cardsSlice, 'PNG', 0, contentTopPt, pageW, cardsSliceHeightPt);
    pdf.addImage(closerCanvas, 'PNG', 0, pageH - closerHeightPt, pageW, closerHeightPt);

    cardsPosPx = endPx;
  }

  return { doc: pdf, filename: `${safeName(userName)}_Foundry_Takeaway.pdf` };
}
