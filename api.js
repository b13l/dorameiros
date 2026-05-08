// api.js

async function fetchDramasFromServer() {
  // 1. Obter credenciais do Firestore
  const snap = await db.collection('settings').doc('server').get();
  const config = snap.data();
  const base = config.urlBase.replace(/\/+$/, ''); // remove barra final
  const user = config.usuario;
  const pass = config.senha;

  // 2. Montar URL da API (padrão Xtream Codes)
  const apiUrl = `${base}/player_api.php?username=${user}&password=${pass}&action=get_vod_streams`;

  // 3. Buscar dados
  const response = await fetch(apiUrl);
  if (!response.ok) throw new Error('Erro ao buscar catálogo');
  const data = await response.json();

  // 4. Transformar no formato que seu app espera
  // Campos comuns: stream_id, name, stream_icon, category_id, container_extension
  const dramas = data.map(item => ({
    id: String(item.stream_id),
    titulo: item.name,
    thumbnail: item.stream_icon || 'placeholder.jpg',
    genero: item.category_name || 'Sem categoria',
    categoriaId: item.category_id,
    // URL do vídeo será montada na hora de assistir
    streamId: item.stream_id,
    containerExtension: item.container_extension || 'mp4'
  }));

  return dramas;
}