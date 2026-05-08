// ----- Planos -----
const planos = [
  { id: '24h', nome: '24 Horas', preco: 'R$ 5,00', duracao: 1 },
  { id: '7d', nome: '7 Dias', preco: 'R$ 14,00', duracao: 7 },
  { id: '30d', nome: '30 Dias', preco: 'R$ 24,99', duracao: 30 },
  { id: '60d', nome: '60 Dias', preco: 'R$ 50,99', duracao: 60 },
  { id: '180d', nome: '180 Dias', preco: 'R$ 89,99', duracao: 180 },
  { id: 'anual', nome: 'Anual (365 dias)', preco: 'R$ 159,90', duracao: 365 }
];

// ----- Variáveis globais -----
let dbCache;
let todasSeries = [];
let seriesVisiveis = [];
let paginaAtual = 1;
const ITENS_POR_PAGINA = 20;
let carregandoSeries = false;
let categorias = [];
let serieAtual = null;
let episodioAtualGlobal = null;
let indiceAtualGlobal = -1;
let previewTimeout = null;
let previewShown = false;
let controlsTimeout = null;
let temporadasEpisodios = {};

// ----- IndexedDB -----
function initLocalDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('DorameirosDB', 3);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('series_list')) {
        db.createObjectStore('series_list', { keyPath: 'series_id' });
      }
      if (!db.objectStoreNames.contains('episodios_cache')) {
        db.createObjectStore('episodios_cache', { keyPath: 'series_id' });
      }
    };
    request.onsuccess = (e) => { dbCache = e.target.result; resolve(dbCache); };
    request.onerror = reject;
  });
}

async function cacheSeriesList(series) {
  if (!dbCache) await initLocalDB();
  const tx = dbCache.transaction('series_list', 'readwrite');
  const store = tx.objectStore('series_list');
  series.forEach(s => store.put(s));
  return tx.complete;
}

async function getCachedSeriesList() {
  if (!dbCache) await initLocalDB();
  return new Promise(resolve => {
    const tx = dbCache.transaction('series_list', 'readonly');
    const store = tx.objectStore('series_list');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
  });
}

async function cacheEpisodiosAgrupados(seriesId, dados) {
  if (!dbCache) await initLocalDB();
  const tx = dbCache.transaction('episodios_cache', 'readwrite');
  const store = tx.objectStore('episodios_cache');
  store.put({ series_id: seriesId, temporadas: dados.temporadas, flat: dados.flat, timestamp: Date.now() });
  return tx.complete;
}

async function getCachedEpisodiosAgrupados(seriesId) {
  if (!dbCache) await initLocalDB();
  return new Promise(resolve => {
    const tx = dbCache.transaction('episodios_cache', 'readonly');
    const store = tx.objectStore('episodios_cache');
    const req = store.get(seriesId);
    req.onsuccess = () => resolve(req.result && req.result.temporadas ? req.result : null);
  });
}

// ----- Configuração do servidor -----
let serverConfigCache = null;
async function getServerConfig() {
  if (serverConfigCache) return serverConfigCache;
  const snap = await db.collection('settings').doc('server').get();
  if (!snap.exists) throw new Error('Configuração ausente');
  serverConfigCache = snap.data();
  return serverConfigCache;
}

// ----- Buscar lista de séries -----
async function fetchSeriesList() {
  console.log('📺 Buscando lista de séries...');
  const cfg = await getServerConfig();
  const base = cfg.urlBase.replace(/\/+$/, '');
  const user = cfg.usuario;
  const pass = cfg.senha;

  const catUrl = `${base}/player_api.php?username=${user}&password=${pass}&action=get_series_categories`;
  const catResp = await fetch(catUrl);
  if (!catResp.ok) throw new Error('Erro categorias');
  const categoriasSeries = await catResp.json();
  const idsDorama = categoriasSeries
    .filter(cat => (cat.category_name || '').toLowerCase().replace(/[^\p{L}\s]/gu, '').includes('dorama'))
    .map(cat => cat.category_id);
  console.log('🆔 IDs dorama:', idsDorama);
  if (idsDorama.length === 0) return [];

  const seriesUrl = `${base}/player_api.php?username=${user}&password=${pass}&action=get_series`;
  const seriesResp = await fetch(seriesUrl);
  if (!seriesResp.ok) throw new Error('Erro séries');
  const todasSeriesRaw = await seriesResp.json();

  const seriesDorama = todasSeriesRaw
    .filter(s => idsDorama.includes(String(s.category_id)))
    .map(s => ({
      series_id: s.series_id,
      titulo: s.name,
      thumbnail: s.cover || '',
      genero: 'Dorama'
    }));

  console.log('🎯 Séries dorama:', seriesDorama.length);
  return seriesDorama;
}

// ----- Buscar episódios agrupados por temporada -----
async function fetchEpisodiosAgrupados(seriesId) {
  console.log('🎬 Buscando episódios da série', seriesId);
  const cached = await getCachedEpisodiosAgrupados(seriesId);
  if (cached) {
    console.log('💾 Episódios carregados do cache local');
    return cached;
  }

  const cfg = await getServerConfig();
  const base = cfg.urlBase.replace(/\/+$/, '');
  const user = cfg.usuario;
  const pass = cfg.senha;
  const infoUrl = `${base}/player_api.php?username=${user}&password=${pass}&action=get_series_info&series_id=${seriesId}`;
  const infoResp = await fetch(infoUrl);
  if (!infoResp.ok) throw new Error('Erro ao buscar episódios');
  const info = await infoResp.json();

  const temporadas = {};
  const flat = [];

  if (info.episodes) {
    Object.keys(info.episodes).sort((a, b) => a - b).forEach(numTemp => {
      const eps = info.episodes[numTemp];
      if (Array.isArray(eps)) {
        const episodiosTemp = eps.map(ep => ({
          id: String(ep.id),
          tituloEpisodio: ep.title || `Ep ${ep.episode_num}`,
          streamId: ep.id,
          container: ep.container_extension || 'mp4',
          numero: ep.episode_num || 0,
          temporada: Number(numTemp)
        }));
        temporadas[numTemp] = episodiosTemp;
        flat.push(...episodiosTemp);
      }
    });
  }

  const resultado = { temporadas, flat };
  await cacheEpisodiosAgrupados(seriesId, resultado);
  return resultado;
}

// ----- Favoritos -----
async function favoritarSerie(seriesId) {
  const user = auth.currentUser;
  if (!user) return;
  const serie = todasSeries.find(s => s.series_id == seriesId);
  if (!serie) return;
  await db.collection('usuarios').doc(user.uid).collection('favoritos').doc(String(seriesId)).set({
    series_id: seriesId,
    titulo: serie.titulo,
    thumbnail: serie.thumbnail,
    genero: serie.genero,
    adicionadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });
  alert('Série favoritada!');
}

async function desfavoritarSerie(seriesId) {
  const user = auth.currentUser;
  if (!user) return;
  await db.collection('usuarios').doc(user.uid).collection('favoritos').doc(String(seriesId)).delete();
  alert('Removido dos favoritos.');
}

async function verificarFavorito(seriesId) {
  const user = auth.currentUser;
  if (!user) return false;
  const doc = await db.collection('usuarios').doc(user.uid).collection('favoritos').doc(String(seriesId)).get();
  return doc.exists;
}

async function carregarFavoritos() {
  const user = auth.currentUser;
  if (!user) return;
  const container = document.getElementById('favoritosContainer');
  container.innerHTML = 'Carregando favoritos...';
  const snapshot = await db.collection('usuarios').doc(user.uid).collection('favoritos').get();
  const favoritos = snapshot.docs.map(doc => doc.data());
  container.innerHTML = favoritos.map(fav => `
    <div class="card" onclick="abrirSerie('${fav.series_id}')">
      <img src="${fav.thumbnail}" alt="${fav.titulo}" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22400%22%3E%3Crect fill=%22%23333%22 width=%22300%22 height=%22400%22/%3E%3Ctext fill=%22%23fff%22 x=%2220%22 y=%22200%22 font-size=%2218%22%3ESem capa%3C/text%3E%3C/svg%3E';">
      <h3>${fav.titulo}</h3>
      <button onclick="event.stopPropagation(); desfavoritarSerie('${fav.series_id}')">Remover</button>
    </div>
  `).join('');
}

async function toggleFavorito() {
  if (!serieAtual) return;
  const seriesId = serieAtual.series_id;
  const isFav = await verificarFavorito(seriesId);
  if (isFav) {
    await desfavoritarSerie(seriesId);
    document.getElementById('btnFavorito').textContent = '☆';
  } else {
    await favoritarSerie(seriesId);
    document.getElementById('btnFavorito').textContent = '⭐';
  }
}

// ----- Navegação do cabeçalho (antigo menu lateral) -----
function mostrarSecao(secao) {
  document.getElementById('lista-dramas').style.display = 'none';
  document.getElementById('paywall').style.display = 'none';
  document.getElementById('favoritosContainer').style.display = 'none';
  if (secao === 'inicio') {
    document.getElementById('lista-dramas').style.display = 'grid';
  } else if (secao === 'planos') {
    document.getElementById('paywall').style.display = 'block';
    mostrarPaywall();
  } else if (secao === 'favoritos') {
    document.getElementById('favoritosContainer').style.display = 'grid';
    carregarFavoritos();
  }
}

// ----- Fluxo de autenticação -----
auth.onAuthStateChanged(async (user) => {
  if (!user) return window.location.href = 'login.html';
  console.log('👤 Usuário logado');
  try {
    const userDoc = await db.collection('usuarios').doc(user.uid).get();
    if (!userDoc.exists) return auth.signOut();
    const dados = userDoc.data();
    const agora = new Date();
    if (dados.assinatura === 'trial') {
      const trialAte = dados.trialAte.toDate();
      if (agora > trialAte) mostrarPaywall();
      else {
        iniciarContador(trialAte);
        await carregarCatalogoInicial();
      }
    } else if (planos.some(p => p.id === dados.assinatura)) {
      const expira = dados.expiracaoAssinatura?.toDate();
      if (expira && agora < expira) await carregarCatalogoInicial();
      else mostrarPaywall();
    } else mostrarPaywall();
  } catch (err) {
    console.error(err);
  }
});

function iniciarContador(dataFinal) {
  const banner = document.getElementById('trial-banner');
  banner.style.display = 'block';
  setInterval(() => {
    const diff = dataFinal - new Date();
    if (diff <= 0) banner.innerHTML = 'Trial expirado.';
    else {
      const h = Math.floor(diff/3600000);
      const m = Math.floor((diff%3600000)/60000);
      const s = Math.floor((diff%60000)/1000);
      banner.innerHTML = `⏳ Teste grátis: ${h}h ${m}m ${s}s restantes`;
    }
  }, 1000);
}

// ----- Carregamento do catálogo e scroll infinito -----
async function carregarCatalogoInicial() {
  const container = document.getElementById('lista-dramas');
  container.innerHTML = 'Carregando catálogo...';

  const cached = await getCachedSeriesList();
  if (cached.length) {
    todasSeries = cached;
    paginaAtual = 1;
    seriesVisiveis = todasSeries.slice(0, ITENS_POR_PAGINA);
    renderizarSeries();
    atualizarCategorias();
  }

  try {
    const seriesOnline = await fetchSeriesList();
    if (seriesOnline.length === 0) {
      if (!cached.length) container.innerHTML = 'Nenhum dorama encontrado.';
      return;
    }
    todasSeries = seriesOnline;
    await cacheSeriesList(seriesOnline);
    paginaAtual = 1;
    seriesVisiveis = todasSeries.slice(0, ITENS_POR_PAGINA);
    renderizarSeries();
    atualizarCategorias();
  } catch (err) {
    console.error(err);
    if (!cached.length) container.innerHTML = 'Catálogo indisponível.';
  }

  window.onscroll = () => {
    if (carregandoSeries) return;
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
      carregarMaisSeries();
    }
  };
}

function carregarMaisSeries() {
  if (!todasSeries.length) return;
  const inicio = paginaAtual * ITENS_POR_PAGINA;
  const fim = inicio + ITENS_POR_PAGINA;
  if (inicio >= todasSeries.length) return;
  carregandoSeries = true;
  const novos = todasSeries.slice(inicio, fim);
  seriesVisiveis = [...seriesVisiveis, ...novos];
  paginaAtual++;
  renderizarSeries();
  carregandoSeries = false;
}

function atualizarCategorias() {
  const cats = new Set(todasSeries.map(s => s.genero));
  categorias = [...cats].sort();
  const select = document.getElementById('filtroCategoria');
  if (!select) return;
  select.innerHTML = '<option value="todas">Todas</option>';
  categorias.forEach(c => {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = c;
    select.appendChild(o);
  });
}

function filtrarSeries() {
  const termo = (document.getElementById('busca')?.value || '').toLowerCase();
  const cat = document.getElementById('filtroCategoria')?.value || 'todas';
  let filtradas = todasSeries;
  if (cat !== 'todas') filtradas = filtradas.filter(s => s.genero === cat);
  if (termo) filtradas = filtradas.filter(s => s.titulo.toLowerCase().includes(termo));
  seriesVisiveis = filtradas.slice(0, ITENS_POR_PAGINA);
  paginaAtual = 1;
  renderizarSeries();
}
document.addEventListener('input', e => {
  if (e.target.id === 'busca' || e.target.id === 'filtroCategoria') filtrarSeries();
});

function renderizarSeries() {
  const container = document.getElementById('lista-dramas');
  container.innerHTML = seriesVisiveis.map(s => `
    <div class="card" onclick="abrirSerie('${s.series_id}')">
      <img src="${s.thumbnail}" alt="${s.titulo}" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22400%22%3E%3Crect fill=%22%23333%22 width=%22300%22 height=%22400%22/%3E%3Ctext fill=%22%23fff%22 x=%2220%22 y=%22200%22 font-size=%2218%22%3ESem capa%3C/text%3E%3C/svg%3E';">
      <h3>${s.titulo}</h3>
      <span class="genero">${s.genero}</span>
    </div>
  `).join('');
}

// ================== MODAL DO PLAYER ==================
const playerModal = document.getElementById('playerModal');

async function abrirSerie(seriesId) {
  document.getElementById('modalTitulo').textContent = 'Carregando...';
  playerModal.style.display = 'flex';
  document.getElementById('painelEpisodios').style.display = 'none';

  let dados;
  try {
    dados = await fetchEpisodiosAgrupados(seriesId);
  } catch (err) {
    const cont = document.getElementById('temporadasContainer');
    if (cont) cont.innerHTML = 'Erro ao carregar episódios.';
    return;
  }

  const serie = todasSeries.find(s => s.series_id == seriesId);
  if (!serie) return;
  serieAtual = { ...serie, temporadas: dados.temporadas, episodiosFlat: dados.flat };
  temporadasEpisodios = dados.temporadas;

  document.getElementById('modalTitulo').textContent = serie.titulo;
  const isFav = await verificarFavorito(seriesId);
  document.getElementById('btnFavorito').textContent = isFav ? '⭐' : '☆';

  renderizarPainelTemporadas(serieAtual.temporadas);

  if (dados.flat.length > 0) {
    reproduzirEpisodio(dados.flat[0], serieAtual);
  }
}

function fecharPlayer() {
  playerModal.style.display = 'none';
  const player = document.getElementById('modalPlayer');
  player.pause();
  player.src = '';
  cancelarPrevia();
  serieAtual = null;
  episodioAtualGlobal = null;
  indiceAtualGlobal = -1;
}

function renderizarPainelTemporadas(temporadas) {
  const container = document.getElementById('temporadasContainer');
  if (!container) return;
  let html = '';
  Object.keys(temporadas).sort((a, b) => a - b).forEach(num => {
    html += `<div class="temporada-grupo"><h4>Temporada ${num}</h4><div class="episodios-lista">`;
    temporadas[num].forEach(ep => {
      const ativo = episodioAtualGlobal === ep.id ? 'ativo' : '';
      html += `<div class="ep-card-mini ${ativo}" onclick="selecionarEpisodioPainel('${ep.id}')"><span>${ep.numero}</span></div>`;
    });
    html += `</div></div>`;
  });
  container.innerHTML = html;
}

function selecionarEpisodioPainel(epId) {
  if (!serieAtual) return;
  const ep = serieAtual.episodiosFlat.find(e => e.id === epId);
  if (ep) {
    reproduzirEpisodio(ep, serieAtual);
    fecharPainelEpisodios();
  }
}

function abrirPainelEpisodios() {
  document.getElementById('painelEpisodios').style.display = 'block';
  document.getElementById('playerControls').style.display = 'none';
}

function fecharPainelEpisodios() {
  document.getElementById('painelEpisodios').style.display = 'none';
  document.getElementById('playerControls').style.display = 'flex';
  resetControlsTimeout();
}

// ================== CONTROLES PERSONALIZADOS ==================
function setupPlayerControls() {
  const player = document.getElementById('modalPlayer');
  const progress = document.getElementById('progressBar');
  const timeDisplay = document.getElementById('timeDisplay');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const wrapper = document.getElementById('playerWrapper');
  const controls = document.getElementById('playerControls');

  if (!player || !progress || !timeDisplay || !playPauseBtn) return;

  // Único listener para timeupdate: atualiza progresso, tempo e prévia
  player.ontimeupdate = () => {
    if (player.duration) {
      // Atualiza progresso e tempo
      progress.value = (player.currentTime / player.duration) * 100;
      timeDisplay.textContent = formatTime(player.currentTime) + ' / ' + formatTime(player.duration);

      // Verifica prévia do próximo episódio (últimos 30s)
      if (!previewShown && indiceAtualGlobal < (serieAtual?.episodiosFlat?.length || 0) - 1) {
        const tempoRestante = player.duration - player.currentTime;
        if (tempoRestante <= 30) {
          mostrarPreviaProximo(serieAtual, indiceAtualGlobal + 1);
        }
      }
    }
  };

  progress.oninput = () => {
    player.currentTime = (progress.value / 100) * player.duration;
  };

  playPauseBtn.onclick = () => togglePlayPause();

  wrapper.onmousemove = showControls;
  wrapper.ontouchstart = showControls;
  wrapper.onclick = showControls;
  controls.onmouseleave = () => resetControlsTimeout();

  document.onfullscreenchange = () => {
    if (document.fullscreenElement) {
      wrapper.classList.add('fullscreen');
    } else {
      wrapper.classList.remove('fullscreen');
    }
  };

  resetControlsTimeout();
}

function showControls() {
  const controls = document.getElementById('playerControls');
  controls.style.opacity = '1';
  controls.style.visibility = 'visible';
  resetControlsTimeout();
}

function resetControlsTimeout() {
  if (controlsTimeout) clearTimeout(controlsTimeout);
  controlsTimeout = setTimeout(hideControls, 4000);
}

function hideControls() {
  if (document.getElementById('painelEpisodios').style.display === 'block') return;
  const controls = document.getElementById('playerControls');
  controls.style.opacity = '0';
  controls.style.visibility = 'hidden';
}

function togglePlayPause() {
  const player = document.getElementById('modalPlayer');
  if (player.paused) player.play();
  else player.pause();
}

function toggleFullscreen() {
  const wrapper = document.getElementById('playerWrapper');
  if (!document.fullscreenElement) {
    wrapper.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ================== REPRODUÇÃO DE EPISÓDIO ==================
async function reproduzirEpisodio(episodio, serie) {
  cancelarPrevia();
  const cfg = await getServerConfig();
  const base = cfg.urlBase.replace(/\/+$/, '');
  const user = cfg.usuario;
  const pass = cfg.senha;
  const videoURL = `${base}/series/${user}/${pass}/${episodio.streamId}.${episodio.container}`;
  console.log('▶ Reproduzindo:', videoURL);

  const player = document.getElementById('modalPlayer');
  player.src = videoURL;
  player.play().catch(err => console.error(err));

  episodioAtualGlobal = episodio.id;
  indiceAtualGlobal = serie.episodiosFlat.findIndex(e => e.id === episodio.id);
  document.getElementById('infoEpisodio').textContent = `${episodio.tituloEpisodio}`;

  renderizarPainelTemporadas(serie.temporadas);

  // O ontimeupdate global (setupPlayerControls) já cuida de progresso e prévia.
  // Reaplicamos o onended para garantir autoavanço se a prévia não apareceu.
  player.onended = () => {
    if (indiceAtualGlobal < serie.episodiosFlat.length - 1) {
      if (!previewShown) {
        mostrarPreviaProximo(serie, indiceAtualGlobal + 1);
      } else {
        proximoEpisodio();
      }
    }
  };
}

// ================== PRÉVIA DO PRÓXIMO EPISÓDIO ==================
function mostrarPreviaProximo(serie, idxProximo) {
  if (previewShown) return;
  previewShown = true;
  const proxEp = serie.episodiosFlat[idxProximo];
  const overlay = document.getElementById('previaOverlay');
  document.getElementById('previaThumb').src = serie.thumbnail || '';
  document.getElementById('previaTitulo').textContent = proxEp.tituloEpisodio;
  overlay.style.display = 'flex';

  let segundos = 30;
  document.getElementById('previaCountdown').textContent = segundos;
  previewTimeout = setInterval(() => {
    segundos--;
    document.getElementById('previaCountdown').textContent = segundos;
    if (segundos <= 0) {
      clearInterval(previewTimeout);
      proximoEpisodio();
    }
  }, 1000);
}

function cancelarPrevia() {
  previewShown = false;
  if (previewTimeout) clearInterval(previewTimeout);
  const overlay = document.getElementById('previaOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ================== NAVEGAÇÃO ENTRE EPISÓDIOS ==================
function episodioAnterior() {
  if (!serieAtual || indiceAtualGlobal <= 0) return;
  cancelarPrevia();
  reproduzirEpisodio(serieAtual.episodiosFlat[indiceAtualGlobal - 1], serieAtual);
}

function proximoEpisodio() {
  if (!serieAtual || indiceAtualGlobal >= serieAtual.episodiosFlat.length - 1) return;
  cancelarPrevia();
  reproduzirEpisodio(serieAtual.episodiosFlat[indiceAtualGlobal + 1], serieAtual);
}

// ----- Paywall -----
function mostrarPaywall() {
  document.getElementById('paywall').style.display = 'block';
  document.getElementById('planosContainer').innerHTML = planos.map(p => `
    <div class="card-plano">
      <h3>${p.nome}</h3>
      <p class="preco">${p.preco}</p>
      <button onclick="alert('Envie comprovante para o suporte')">Quero este</button>
    </div>
  `).join('');
}

// Inicializa controles na primeira vez que o modal for mostrado
const observerPlayer = new MutationObserver((mutations) => {
  if (playerModal.style.display === 'flex') {
    setupPlayerControls();
  }
});
observerPlayer.observe(playerModal, { attributes: true, attributeFilter: ['style'] });