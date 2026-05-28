/* ================================================================
   TASKFLOW — sw.js (Service Worker)
   ================================================================

   O QUE É UM SERVICE WORKER?
   ──────────────────────────
   Um Service Worker é um script JavaScript que o navegador executa
   em background, em uma thread separada da página principal.
   Ele atua como um PROXY PROGRAMÁVEL entre a sua aplicação web
   e a rede, interceptando todas as requisições HTTP e decidindo
   o que fazer com cada uma delas (buscar da rede, do cache, etc.).

   CAPACIDADES PRINCIPAIS:
   • Cache de recursos para funcionamento offline
   • Estratégias de cache personalizadas (Cache First, Network First…)
   • Push Notifications (não abordado neste projeto)
   • Background Sync (não abordado neste projeto)

   RESTRIÇÕES IMPORTANTES:
   • Só funciona em HTTPS (ou localhost/127.0.0.1 para desenvolvimento)
   • Não tem acesso ao DOM (roda em thread separada)
   • É assíncrono (usa Promises e async/await extensivamente)
   • O escopo define quais páginas ele controla (definido no registro)

   DIAGRAMA DO LIFECYCLE (ciclo de vida):
   ────────────────────────────────────
        Navegador baixa sw.js
               │
               ▼
         [ INSTALLING ]  ← evento 'install'
         (cria o cache / "App Shell")
               │
        ┌──────┴──────┐
        │  Sucesso    │  Erro → descartado
        ▼
         [ INSTALLED / WAITING ]
         (aguarda o SW antigo ser desativado)
               │
               ▼ (página recarregada / sem SW anterior)
         [ ACTIVATING ]  ← evento 'activate'
         (limpa caches antigos)
               │
               ▼
         [ ACTIVATED ]
         (controla as páginas no escopo)
               │
               ▼
         [ FETCH ]  ← evento 'fetch' (para cada requisição)
         (intercepta e responde com cache ou rede)
               │
               ▼
         [ REDUNDANT ] (se uma versão nova é instalada)

   ================================================================ */

'use strict';

/* ── CONFIGURAÇÕES DE CACHE ──────────────────────────────────────
   CACHE_NAME: Identificador único desta versão do cache.
   SEMPRE incremente a versão (ex: v1 → v2) ao fazer deploy de
   atualizações, pois isso aciona o evento 'activate' e faz a
   limpeza automática do cache antigo.

   APP_SHELL_RESOURCES: Lista de recursos essenciais do "App Shell"
   — o esqueleto mínimo da aplicação que precisa estar disponível
   offline. Inclui HTML, CSS, JS, ícones e fontes locais.
   ──────────────────────────────────────────────────────────────── */
const CACHE_NAME = 'taskflow-cache-v1';

const APP_SHELL_RESOURCES = [
  './',                         // index.html (via diretório raiz)
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
];

/* ================================================================
   EVENTO: install
   ────────────────────────────────────────────────────────────────
   QUANDO É DISPARADO:
     O evento 'install' é o PRIMEIRO evento do lifecycle do SW.
     Ele é disparado logo após o navegador baixar e analisar o
     arquivo sw.js com sucesso.

   O QUE FAZEMOS AQUI:
     Pré-cacheamos o "App Shell" — todos os recursos estáticos
     necessários para que a aplicação carregue mesmo sem rede.
     Esta é a etapa de "instalação offline" da nossa PWA.

   event.waitUntil():
     Recebe uma Promise e sinaliza ao navegador que o processo
     de instalação não deve ser considerado concluído até que
     essa Promise seja resolvida. Se a Promise rejeitar,
     a instalação falha e o SW é descartado.
   ================================================================ */
self.addEventListener('install', (event) => {
  console.log(`[SW] 🔧 Evento: install — Cache "${CACHE_NAME}" sendo criado...`);

  event.waitUntil(
    (async () => {
      // Abre (ou cria) o cache com o nome definido em CACHE_NAME
      const cache = await caches.open(CACHE_NAME);

      console.log('[SW] 📦 Pré-cacheando recursos do App Shell...');

      try {
        // addAll() baixa TODOS os recursos e os salva no cache.
        // Se qualquer recurso falhar (404, erro de rede), toda a
        // instalação falha — garantindo consistência do App Shell.
        await cache.addAll(APP_SHELL_RESOURCES);
        console.log('[SW] ✅ App Shell cacheado com sucesso!');
        console.log('[SW] Recursos cacheados:', APP_SHELL_RESOURCES);
      } catch (err) {
        console.error('[SW] ❌ Falha ao cachear o App Shell:', err);
        // Re-lança o erro para que waitUntil() rejeite e o SW falhe
        throw err;
      }

      /* self.skipWaiting()
         ──────────────────
         Por padrão, um novo SW fica em estado "waiting" até que
         TODAS as abas que usam o SW antigo sejam fechadas.
         skipWaiting() força o novo SW a se tornar ativo IMEDIATAMENTE,
         sem esperar. Útil durante o desenvolvimento, mas use com
         cautela em produção (pode causar inconsistências se o usuário
         tiver abas abertas com a versão antiga).
         Em produção, considere mostrar um "Atualizar" ao usuário. */
      await self.skipWaiting();
      console.log('[SW] ⏩ skipWaiting() chamado — SW assumirá o controle imediatamente.');
    })()
  );
});

/* ================================================================
   EVENTO: activate
   ────────────────────────────────────────────────────────────────
   QUANDO É DISPARADO:
     Após a instalação ser concluída e o SW antigo ser descartado
     (ou imediatamente após skipWaiting()), o evento 'activate'
     é disparado. O SW ainda NÃO controla as páginas abertas
     neste momento (a menos que clients.claim() seja chamado).

   O QUE FAZEMOS AQUI:
     Limpamos caches ANTIGOS (versões anteriores de CACHE_NAME).
     Isso libera espaço no disco do usuário e evita que recursos
     desatualizados sejam servidos nas próximas sessões.

   ESTRATÉGIA DE LIMPEZA:
     Listamos todos os caches existentes e removemos qualquer um
     cujo nome seja diferente do CACHE_NAME atual.
   ================================================================ */
self.addEventListener('activate', (event) => {
  console.log(`[SW] ✨ Evento: activate — Verificando caches antigos para limpeza...`);

  event.waitUntil(
    (async () => {
      // Lista com os nomes de todos os caches desta origin
      const cacheNames = await caches.keys();
      console.log('[SW] Caches encontrados:', cacheNames);

      // Filtra apenas os caches que pertencem ao TaskFlow mas
      // são de versões anteriores (nome diferente do atual)
      const cachesToDelete = cacheNames.filter(
        (name) => name.startsWith('taskflow-') && name !== CACHE_NAME
      );

      if (cachesToDelete.length > 0) {
        console.log('[SW] 🗑️ Removendo caches obsoletos:', cachesToDelete);
        await Promise.all(cachesToDelete.map((name) => caches.delete(name)));
        console.log('[SW] ✅ Caches antigos removidos com sucesso.');
      } else {
        console.log('[SW] 👍 Nenhum cache antigo encontrado. Tudo limpo!');
      }

      /* clients.claim()
         ───────────────
         Por padrão, um SW recém-ativado só controla páginas abertas
         APÓS o registro. Páginas já abertas continuam sendo controladas
         pelo SW antigo (ou por nenhum, se for a primeira instalação).
         clients.claim() força o SW a assumir o controle de TODAS as
         páginas abertas imediatamente, sem necessidade de reload.
         Deve ser usado em conjunto com skipWaiting(). */
      await self.clients.claim();
      console.log('[SW] 👑 clients.claim() chamado — SW controla todas as abas abertas!');
    })()
  );
});

/* ================================================================
   EVENTO: fetch
   ────────────────────────────────────────────────────────────────
   QUANDO É DISPARADO:
     Para CADA requisição HTTP feita pela página (HTML, CSS, JS,
     imagens, chamadas a APIs, fontes, etc.). O SW pode interceptar
     e responder de diversas formas.

   ESTRATÉGIA UTILIZADA: "Cache First" (com fallback para rede)
   ─────────────────────────────────────────────────────────────
   A estratégia "Cache First" funciona assim:

     1. Verifica se a resposta para a requisição já está no cache.
     2. SE estiver → retorna do cache imediatamente (ultra-rápido,
        funciona offline!).
     3. SE NÃO estiver → faz a requisição pela rede, salva a
        resposta no cache para uso futuro, e retorna a resposta.
     4. SE a rede falhar e não houver cache → retorna uma resposta
        de fallback (opcional, mas boa prática).

   QUANDO USAR "Cache First":
     Ideal para recursos estáticos que não mudam frequentemente:
     HTML, CSS, JS, ícones, imagens. Maximiza a velocidade e o
     funcionamento offline.

   ALTERNATIVAS (não implementadas aqui, mas importantes de conhecer):
     • Network First: tenta rede primeiro; usa cache se offline.
       Ideal para dados dinâmicos (APIs, feeds).
     • Stale While Revalidate: retorna cache IMEDIATAMENTE e
       atualiza o cache em background. Equilibrio entre velocidade
       e atualização.
     • Network Only: nunca usa cache. Para requisições que sempre
       precisam de dados frescos.
     • Cache Only: nunca vai à rede. Para recursos que nunca mudam.
   ================================================================ */
self.addEventListener('fetch', (event) => {

  // ── FILTROS: Não interceptamos certas requisições ────────────

  // 1. Ignorar métodos que não sejam GET (POST, PUT, DELETE, etc.)
  //    O cache da Cache API trabalha apenas com requisições GET.
  if (event.request.method !== 'GET') return;

  // 2. Ignorar requisições cross-origin (outras origens/domínios)
  //    como APIs externas, CDNs de terceiros — a menos que você
  //    queira cacheá-las explicitamente (ex: Google Fonts).
  const requestURL = new URL(event.request.url);
  if (requestURL.origin !== location.origin) {
    // Para este projeto, deixamos o navegador lidar com
    // recursos externos normalmente (sem interceptar).
    // Se quiser cachear fontes do Google, adicione lógica aqui.
    return;
  }

  // ── ESTRATÉGIA: Cache First ──────────────────────────────────
  event.respondWith(
    (async () => {
      /* PASSO 1: Procura no cache
         caches.match() procura em TODOS os caches (não apenas no
         CACHE_NAME). Retorna a resposta cacheada ou undefined. */
      const cachedResponse = await caches.match(event.request);

      if (cachedResponse) {
        // Cache HIT — responde imediatamente do cache
        console.log(`[SW] 📋 Cache HIT: ${event.request.url}`);
        return cachedResponse;
      }

      // Cache MISS — precisamos ir à rede
      console.log(`[SW] 🌐 Cache MISS, buscando na rede: ${event.request.url}`);

      try {
        /* PASSO 2: Busca na rede
           Clonamos a requisição porque um objeto Request é um
           "stream" e só pode ser consumido uma vez. */
        const networkResponse = await fetch(event.request.clone());

        /* PASSO 3: Valida a resposta antes de cachear
           Só cacheamos respostas válidas (status 200).
           Não cacheamos erros (4xx, 5xx) nem respostas opaque
           (type 'opaque' = requisições cross-origin sem CORS). */
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === 'basic'
        ) {
          // Clona a resposta: uma cópia vai para o cache,
          // a original é retornada ao navegador.
          // (Responses também são streams de uso único!)
          const responseToCache = networkResponse.clone();

          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, responseToCache);
          console.log(`[SW] 💾 Recurso cacheado dinamicamente: ${event.request.url}`);
        }

        return networkResponse;

      } catch (networkError) {
        /* PASSO 4: Fallback — sem cache E sem rede
           O usuário está offline e o recurso não estava cacheado.
           Podemos retornar uma página de fallback genérica. */
        console.warn(`[SW] ⚠️ Sem cache e sem rede para: ${event.request.url}`, networkError);

        // Se for uma navegação para uma página HTML, retornamos
        // o index.html cacheado como fallback (SPA pattern).
        if (event.request.destination === 'document') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }

        // Resposta de erro genérica para outros recursos
        return new Response('Recurso não disponível offline.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })()
  );
});

/* ================================================================
   EVENTO: message
   ────────────────────────────────────────────────────────────────
   Permite comunicação entre o SW e as páginas client.
   Aqui tratamos um comando 'SKIP_WAITING' que pode ser enviado
   pelo app.js para forçar a atualização do SW sem recarregar.
   Útil para implementar um botão "Atualizar App" na UI.
   ================================================================ */
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    console.log('[SW] 📩 Mensagem recebida: SKIP_WAITING — forçando atualização...');
    self.skipWaiting();
  }
});

/* ================================================================
   RESUMO DO FLUXO COMPLETO (referência rápida):

   1ª visita (online):
     install  → cache App Shell
     activate → limpa caches antigos
     fetch    → Cache MISS → busca na rede → salva no cache

   2ª visita (online ou offline):
     fetch → Cache HIT → retorna do cache instantaneamente ⚡

   Atualização (novo sw.js detectado pelo navegador):
     install  → instala nova versão em paralelo
     skipWaiting → substitui SW antigo imediatamente
     activate → limpa cache da versão anterior (v1 removido)
     fetch    → serve com o novo cache (v2)
   ================================================================ */
