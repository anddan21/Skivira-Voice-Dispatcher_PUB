// viewport-fix.js v5.1 — lock chat to visible viewport on mobile (keyboard-safe)
(function(){
  const docEl = document.documentElement;
  const $ = (sel) => document.querySelector(sel);
  const header = () => $('header');
  const main = () => $('main');
  const log = () => $('#log');
  const footer = () => $('footer');

  const setVars = () => {
    const vp = window.visualViewport;
    const height = vp ? vp.height : window.innerHeight;
    const vh = height * 0.01;
    docEl.style.setProperty('--vh', `${vh}px`);
    const h = header() ? header().offsetHeight : 56;
    docEl.style.setProperty('--header-h', `${h}px`);
  };

// --- FIX HERE ---

  const applyHeights = () => {
    const vp = window.visualViewport;
    const height = vp ? vp.height : window.innerHeight;
    const hHeader = header() ? header().offsetHeight : 56;
    const hFooter = footer() ? footer().offsetHeight : 110; // 1. Get footer height

    // 2. Calculate <main> height, SUBTRACTING both header and footer
    const mainH = Math.max(320, Math.floor(height - hHeader - hFooter));
    if (main()) main().style.height = `${mainH}px`;

    // 3. REMOVE old #log calculation logic
    // CSS (flex: 1) in main.css will automatically fill
    // <main> with the #log element.
    
    /* (Old code removed)
    let used = 0;
    if (footer()) used += footer().offsetHeight || 0;
    const logH = Math.max(120, mainH - used); 
    if (log()) log().style.height = `${logH}px`; 
    */
  };

// --- END OF FIX ---

  const tick = () => { setVars(); applyHeights(); };

  window.addEventListener('resize', tick);
  window.addEventListener('orientationchange', tick);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', tick);
    window.visualViewport.addEventListener('scroll', tick);
  }
  window.addEventListener('load', tick, { once: true });

  const prompt = $('#prompt');
  if (prompt) {
    prompt.addEventListener('focus', () => {
      setTimeout(() => {
        prompt.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        tick();
      }, 80);
    });
    prompt.addEventListener('input', () => {
      requestAnimationFrame(tick);
    });
  }

  tick();
})();