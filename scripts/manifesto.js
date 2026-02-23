(() => {
  const stream = document.querySelector('.manifesto-stream');
  if (!stream) return;

  const LENGTH = 2000-5;
  const BASE_CHANGE_CHANCE = 0.5;
  const HIGHLIGHT_CHANCE = 0.22;
  const CENSORED_GLYPH = '█';
  const SYMBOLS = [
    '@', '#', '$', '%', '&', '*', '+', '=', '?', '/', '\\', '|', '~', '^',
    '!', '>', '<', '{', '}', '(', ')', '[', ']', ':', ';', '-', '_',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
  ];

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const changeChance = prefersReducedMotion ? 0.12 : BASE_CHANGE_CHANCE;
  const tickInterval = prefersReducedMotion ? 420 : 140;

  const spans = new Array(LENGTH);
  const frag = document.createDocumentFragment();

  for (let i = 0; i < LENGTH; i += 1) {
    const span = document.createElement('span');
    spans[i] = span;
    frag.appendChild(span);
  }

  stream.appendChild(frag);

  const randomSymbol = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

  function applySymbol(span) {
    span.textContent = randomSymbol();
    span.classList.remove('censored');
    if (Math.random() < HIGHLIGHT_CHANCE) {
      span.classList.add('highlight');
    } else {
      span.classList.remove('highlight');
    }
  }

  function applyCensored(span) {
    span.textContent = CENSORED_GLYPH;
    span.classList.add('censored');
    span.classList.remove('highlight');
  }

  spans.forEach(span => {
    if (Math.random() < 0.4) {
      applyCensored(span);
    } else {
      applySymbol(span);
    }
  });

  let intervalId = null;

  function tick() {
    for (let i = 0; i < spans.length; i += 1) {
      if (Math.random() < changeChance) {
        if (Math.random() < 0.5) {
          applySymbol(spans[i]);
        } else {
          applyCensored(spans[i]);
        }
      }
    }
  }

  function startAnimation() {
    if (intervalId !== null) return;
    intervalId = window.setInterval(tick, tickInterval);
  }

  function stopAnimation() {
    if (intervalId === null) return;
    window.clearInterval(intervalId);
    intervalId = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAnimation();
    } else {
      startAnimation();
    }
  });

  startAnimation();
})();
