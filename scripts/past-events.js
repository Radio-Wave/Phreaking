fetch('/json/schema.json')
  .then(function(r){ return r.json(); })
  .then(function(data){
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  });

const filterButtons = document.querySelectorAll('.filter-btn:not(.sort-btn)');
const sections = document.querySelectorAll('.category-section');
const pill = document.querySelector('.filter-pill');
const sortBtn = document.getElementById('sort-btn');

function movePill(button){
  if(!button) return;
  const parentRect = button.parentElement.getBoundingClientRect();
  const rect = button.getBoundingClientRect();
  pill.style.width = rect.width + 'px';
  pill.style.height = rect.height + 'px';
  pill.style.transform = `translateX(${rect.left - parentRect.left}px)`;
}

function setFilter(filter, updateUrl = true){
  filterButtons.forEach(btn=>{
    const active = btn.dataset.filter === filter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });
  if(filter === 'all'){
    sections.forEach(section=>{ section.classList.remove('hidden'); });
  } else {
    sections.forEach(section=>{ section.classList.toggle('hidden', section.dataset.category !== filter); });
  }
  const activeButton = document.querySelector(`.filter-btn[data-filter="${filter}"]`);
  movePill(activeButton);
  if (updateUrl) {
    const newUrl = filter === 'all' ? window.location.pathname : `#${filter}`;
    window.history.pushState(null, '', newUrl);
  }
}

filterButtons.forEach(button=>{ button.addEventListener('click', ()=>{ setFilter(button.dataset.filter, true); }); });

window.addEventListener('load', ()=>{
  const hashFilter = window.location.hash.replace('#', '');
  const validFilters = ['talks', 'workshops', 'performances', 'screenings'];
  if (hashFilter && validFilters.includes(hashFilter)) { setFilter(hashFilter, false); } else { setFilter('all', false); }
});

window.addEventListener('hashchange', ()=>{
  const hashFilter = window.location.hash.replace('#', '');
  const validFilters = ['talks', 'workshops', 'performances', 'screenings'];
  if (hashFilter && validFilters.includes(hashFilter)) { setFilter(hashFilter, false); } else { setFilter('all', false); }
});

window.addEventListener('resize', ()=>{ movePill(document.querySelector('.filter-btn.active')); });

let isDescending = true;
sortBtn.addEventListener('click', () => {
  isDescending = !isDescending;
  sortBtn.textContent = isDescending ? 'Sort: Newest First ↓' : 'Sort: Oldest First ↑';
  const eventStacks = document.querySelectorAll('.event-stack');
  eventStacks.forEach(stack => {
    const cards = Array.from(stack.children);
    cards.reverse();
    cards.forEach(card => stack.appendChild(card));
  });
});

const galleryImages = Array.from(document.querySelectorAll('.image-row img'));
const lightbox = document.querySelector('.pc-lightbox');
const lightboxImg = document.querySelector('.pc-lightbox__img');
const lightboxCaption = document.querySelector('.pc-lightbox__caption');
const closeBtn = document.querySelector('.pc-lightbox__close');
const prevBtn = document.querySelector('.pc-lightbox__prev');
const nextBtn = document.querySelector('.pc-lightbox__next');
let currentIndex = 0;

function openLightbox(index){
  currentIndex = index;
  const img = galleryImages[currentIndex];
  lightboxImg.src = img.dataset.full || img.src;
  lightboxImg.alt = img.alt;
  lightboxCaption.textContent = img.alt;
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeLightbox(){ lightbox.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
function updateLightbox(direction){ if (galleryImages.length === 0) return; currentIndex = (currentIndex + direction + galleryImages.length) % galleryImages.length; openLightbox(currentIndex); }

galleryImages.forEach((img,index)=>{ img.parentElement.addEventListener('click', ()=>{ openLightbox(index); }); });
closeBtn.addEventListener('click', closeLightbox);
nextBtn.addEventListener('click', ()=>{ updateLightbox(1); });
prevBtn.addEventListener('click', ()=>{ updateLightbox(-1); });
lightbox.addEventListener('click', (e)=>{ if(e.target === lightbox){ closeLightbox(); } });
document.addEventListener('keydown', (e)=>{
  if(lightbox.getAttribute('aria-hidden') === 'false'){
    if(e.key === 'Escape'){ closeLightbox(); }
    if(e.key === 'ArrowRight'){ updateLightbox(1); }
    if(e.key === 'ArrowLeft'){ updateLightbox(-1); }
  }
});
